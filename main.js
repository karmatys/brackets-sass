/**
 * Copyright (C) 2016 Kamil Armatys
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/*jshint plusplus: false, devel: true, nomen: true, indent: 4, maxerr: 50, regexp: true, strict: true, boss:true */
/*global _, define, brackets, $ */

define(function (require, exports, module) {
   "use strict";
   
   var AppInit            = brackets.getModule("utils/AppInit"),
       CodeHintManager    = brackets.getModule("editor/CodeHintManager"),
       EditorManager      = brackets.getModule("editor/EditorManager"),
       DocumentManager    = brackets.getModule("document/DocumentManager"),
       FileUtils          = brackets.getModule("file/FileUtils"),
       FileSystem         = brackets.getModule("filesystem/FileSystem"),
       StringMatch        = brackets.getModule("utils/StringMatch"),
       ExtensionUtils     = brackets.getModule("utils/ExtensionUtils"),
       Async              = brackets.getModule("utils/Async"),
       PreferencesManager = brackets.getModule("preferences/PreferencesManager");
       
   var HintItem = require("HintItem"),
       Strings  = require("i18n!nls/strings");
   
   // Preferences variables
   var commonLibPath    = "",
       maxHintNumber    = 50,
       sassHintsEnabled = true;
   
   // All file extensions that are supported
   var fileExtensions  = ["scss"],
       hasSaveListener = false;
   
   // Enable hints for sass files
   PreferencesManager.definePreference("codehint.SassHint", "boolean", true, {
      description: Strings.DESCRIPTION_SASSHINTS
   });
   
   // Limit hint lists
   PreferencesManager.definePreference("sasscodehints.maxHints", "number", 50, {
      description: Strings.DESCRIPTION_MAXHINTS
   });
   
   // Path to common sass "partial" file which can be imported to project
   PreferencesManager.definePreference("sasscodehints.commonLibs", "string", "", {
      description: Strings.DESCRIPTION_COMMON_LIBS
   });
   
   PreferencesManager.on("change", "sasscodehints.maxHints", function(){
      maxHintNumber = parseInt(PreferencesManager.get("sasscodehints.maxHints"));
   });
   
   PreferencesManager.on("change", "sasscodehints.commonLibs", function(){
      commonLibPath = PreferencesManager.get("sasscodehints.commonLibs");
   });
   
   PreferencesManager.on("change", "codehint.SassHint", function(){
      sassHintsEnabled = !!PreferencesManager.get("codehint.SassHint");
   });

   /**
    * @constructor
    */
   function SassHint() {
      
      // const hint modes
      this.hintModes = Object.freeze({
         "VAR": 0,
         "FN":  1,
         "KEY": 2,
         "MIX": 3
      });
      
      // reference to current session editor
      this.crrEditor = null;
      
      this.cursorCache = {line: 0, ch: 0};
      
      // space for variable list
      this.varCache = [];
      
      // space for mixin list
      this.mixCache = [];
      
      // space for function list
      this.fnCache = [];
      
      // space for local (current file) variable list
      this.varLocal = [];
      
      // space for local (current file) mixin list
      this.mixLocal = [];
      
      // space for local (current file) function list
      this.fnLocal  = [];
      
      // sass keywords
      this.keywords = ["import", "mixin", "extend", "function", "include", "media", "if", "return", "for", "each", "while"];
      
      // imported files object
      this.importedFiles = {
         'names': [],
         'handlers': []
      };
      
      this.triggerHints = {
         "$": this.hintModes.VAR, // start hinting session for variables
         "@": this.hintModes.KEY, // start hinting session for sass keywords
         ":": this.hintModes.FN   // start hinting session for functions
      };
      
      // define what is currently searched
      this.crrHintMode  = 0;
      this.lastHintMode = null;
      
      // expresion for variables
      this.varRegExp     = /\$([A-Za-z0-9_\-]+):\s*([^\n;]+);/g;
      this.mixRegExp     = /@mixin\s+([A-Za-z0-9\-_]+)\s*(?:\(([^\{\(]*)\))?\s*\{/g;
      this.fnRegExp      = /@function\s+([A-Za-z0-9\-_]+)\s*\(([^\{\(]*)\)\s*\{/g;
      this.commentRegExp = /(?:\/\*[^]*?\*\/|\/\/[^\n]*)/g;
      
      // define if new session is required
      this.newSession = false;
      
      // prepare some properties
      this._init();
   }
   
   /**
    * Prepare object to work. This will be called only once, when instace was created
    */
   SassHint.prototype._init = function(){
      // prepare keywords
      this.keywords = this.keywords.map(function(key){
         return new HintItem(key, "keywords", "K");
      }); 
   };
   
   /**
    * Prepare instance. This will be called whenever sass file will be opened
    */
   SassHint.prototype.init = function(){
      // scan current file in search of @import declarations
      this.scanFiles(DocumentManager.getCurrentDocument());
   };
   
   /**
    * Determine whether hints are available for a given editor context
    *
    * @param  {Editor} editor        the current editor context
    * @param  {string} implicitChar  charCode of the last pressed key
    *
    * @return {boolean}  can the provider provide hints for this session?
    */
   SassHint.prototype.hasHints = function(editor, implicitChar){
      // check for explicit hint request
      if(implicitChar === null){
         var cursor    = editor.getCursorPos(),
             startChar = 0;

         // hint mode was changed in previous session
         if(this.crrHintMode !== null && this.newSession){
            this._getLocalHints({line: -1}, this.crrHintMode);
            this.cursorCache = cursor;
            this.newSession  = false;
            return true;
         }
         
         var token = this._getToken(cursor, {line: cursor.line, ch: 0}),
             match = /([$@:][\w\-]*)\s*([\w\-]*)$/.exec(token);
         
         // nothing found
         if(!match){
            return false;
         }
         
         // maybe we should display mixins or function hint
         if(match[2] !== ""){
            startChar = match[2].length;
            
            // mixins and keywords have the same trigger symbol @, so we must distinguish @include from other keywords
            this.crrHintMode = (match[1] === "@include") ? this.hintModes.MIX : this.hintModes.FN;
         } else {
            startChar = match[0].length-1;
            this.crrHintMode = this.triggerHints[match[1].charAt(0)];
         }
         
         this._getLocalHints(cursor, this.crrHintMode);
         
         this.cursorCache     = cursor;
         this.cursorCache.ch -= startChar;
         
         return true;
      }
      
      // hint request in standard mode
      if(typeof this.triggerHints[implicitChar] !== "undefined"){
         var cursor = editor.getCursorPos();
         this.crrHintMode = this.triggerHints[implicitChar];
         
         this._getLocalHints(cursor, this.crrHintMode);
         
         this.cursorCache = cursor;
         this.crrEditor   = editor;
         
         return true;
      }
      
      this.crrHintMode = null;
      return false;
   };
   
   /**
    * Return a list of hints, possibly deferred, for the current editor context
    *
    * @param {string} implicitChar  charCode of the last pressed key
    *
    * @return {Object}  hint response (immediate or deferred) as defined by the CodeHintManager API
    */
   SassHint.prototype.getHints = function(implicitChar){
      var hintsResult = [],
          token       = "",
          cursor      = this.crrEditor.getCursorPos();
      
      if(cursor.line !== this.cursorCache.line || cursor.ch < this.cursorCache.ch){
         console.log("close hints");
         this.crrHintMode = null;
         return false;
      }
      
      // get token from editor
      token = this._getToken(cursor);
      
      switch(this.crrHintMode){
         case this.hintModes.VAR:
            hintsResult = this._matchHints(this.varLocal, token);
            break;
         
         case this.hintModes.KEY:
            if(token === "include "){
              this.crrHintMode = this.hintModes.MIX;
              return this.newSession = true;
            }
            hintsResult = this._matchHints(this.keywords, token);
            break;
         
         case this.hintModes.MIX:
            if(implicitChar === " "){
               token = null;
               this.cursorCache.ch += 1;
            }
            
            hintsResult = this._matchHints(this.mixLocal, token);
            break;
            
         case this.hintModes.FN:
            if(implicitChar === " " || implicitChar === ":"){
               token = null;
               this.cursorCache.ch += 1;
            }
            
            hintsResult = this._matchHints(this.fnLocal, token);
            break;
      }
      
      if(hintsResult > maxHintNumber){
         hintsResult = hintsResult.slice(0, maxHintNumber);
      }
      
      return {
         hints: this._formatHints(hintsResult),
         match: null,
         selectInitial: true,
         handleWideResults: false
      };
   };
   
   /**
    * Inserts a given CSS protertyname or - value hint into the current editor context.
    *
    * @param {jQuery} hint  The hint to be inserted into the editor context.
    *
    * @return {boolean}  Indicates whether the manager should follow hint insertion with an additional explicit hint request.
    */
   SassHint.prototype.insertHint = function(hint){
      var insertText = hint.data("token"),
          keepHints  = false,
          start      = {line: 0, ch: this.cursorCache.ch},
          end        = {line: 0, ch: 0};
      
      if(insertText === "include"){
         keepHints   = true;
         insertText += " ";
         
         this.crrHintMode = this.hintModes.MIX;
         this.newSession  = keepHints = true;
      } else {
         this.crrHintMode = null;
      }
      
      start.line = end.line = this.cursorCache.line;
      end.ch     = start.ch + insertText.length;
      
      // insert hint to editor
      this.crrEditor._codeMirror.replaceRange(insertText, start, end);

      return keepHints;
   };
   
   /**
    * Set new editor which will be used by SassHint
    *
    * @param {Editor} editor  New editor
    */
   SassHint.prototype.setEditor = function(editor){
      this.crrEditor = editor;
   };
   
   /**
    * Clear all internal cache (cursor, variables, functions ect.)
    */
   SassHint.prototype.clearCache = function(){
      this.cursorCache   = {line: 0, ch: 0};
      this.importedFiles = {'names': [], 'handlers': []};
      this.varCache      = [];
      this.fnCache       = [];
      this.mixCache      = [];
   };
   
   /**
    * Get token from specified range
    *
    * @param {Object} currentCursor  Current cursor position (end of range)
    * @param {Object} startCursr     Optional. If this parameter is omitted, cached cursor will be used
    *
    * @return {string}  Fragment text from editor
    */
   SassHint.prototype._getToken = function(currentCursor, startCursor){
      startCursor = startCursor || this.cursorCache;
      return this.crrEditor._codeMirror.getRange(startCursor, currentCursor);
   };
   
   /**
    * Sort and convert and prepare to display hints (convert to html)
    *
    * @param {Array<HintItem>} hints  Final hints collection
    *
    * @return {Array}  Formatted hint list
    */
   SassHint.prototype._formatHints = function(hints){
      StringMatch.multiFieldSort(hints, { matchGoodness: 0, name: 1 });
      
      return hints.map(function(hint){
         return hint.toHTML();
      });
   };
   
   /**
    * Compare two arrays
    *
    * @param {Array} array1  First array to compare
    * @param {Array} array2  Second array to comapre
    *
    * @return {boolean} true if two arrays are equal, otherwise false
    */
   SassHint.prototype._equalArrays = function(array1, array2){
      if((!Array.isArray(array1) || !Array.isArray(array2)) || (array1.length !== array2.length)) return false;
      
      var i   = 0,
          len = array1.length;
      
      for(; i<len; i++){
         if(array1[i] !== array2[i]) return false;
      }
      
      return true;
   };
   
   /**
    * Find imported files in document and scan them in search of variables, mixins or/and functions
    *
    * @param {Document} doc  Document which will be scanned
    */
   SassHint.prototype.scanFiles = function(doc){
      var importExp  = /@import\s*(['"])([a-zA-Z0-9_\-\.\/]+)\1;/g,
          docTxt     = doc.getText(),
          parentPath = doc.file.parentPath,
          match      = [],
          files      = [],
          self       = this; 
      
      // remove comments from doc
      docTxt = docTxt.replace(this.commentRegExp, "");

      while((match = importExp.exec(docTxt)) !== null){
         // if we pass a file without an extension find a files with all supported extension
         if(FileUtils.getFileExtension(match[2]) === ""){
            fileExtensions.forEach(function(extension){
               files.push(match[2] + "." + extension);
            });
         } else {
            files.push(match[2]);
         }
      }
      
      // if nothing was imported, finish scan
      if(!files.length || this._equalArrays(files, this.importedFiles.names)) return false;
      
      // clear cache
      this.clearCache();
      
      // store imported file names
      this.importedFiles.names = files;
      
      // clear names, to prepare array for store file handlers
      files = [];
      
      Async.doInParallel(this.importedFiles.names, function(fileName){
         var $defer = new $.Deferred();
         
         FileSystem.resolve(parentPath + fileName, function(str, file){
            if(typeof file !== "undefined"){
               $defer.resolve(file);
               return false;
            } 
            
            if(commonLibPath === ""){
               $defer.reject(fileName);
               return false;
            }
            
            FileSystem.resolve(commonLibPath + fileName, function(str, file){
               if(typeof file !== "undefined"){
                  $defer.resolve(file);
               }else{
                  $defer.reject(fileName);
               }
            });
         });
         
         // if file is found try open it
         $defer.done(function(file){
            files.push(file);
            
            // read file
            DocumentManager.getDocumentText(file).done(function(text){
               var hintResult = {},
                   startTime  = new Date();
               
               // remove comments
               text = text.replace(this.commentRegExp, "");
               
               // get functions from file
               hintResult   = self._getFunctions(text, fileName, true);
               self.fnCache = self.fnCache.concat(hintResult.hints);
               
               // get mixins from file
               hintResult    = self._getMixins(hintResult.text, fileName, true);
               self.mixCache = self.mixCache.concat(hintResult.hints);
               
               // get variables from file
               self.varCache = self.varCache.concat(self._getVariables(hintResult.text, fileName));
               console.log("Czas przetwarzania pliku " +fileName+": "+ (new Date().getTime() - startTime.getTime()));
            }).fail(function(){
               console.warn("Can't open file: " + fileName);
            });
         }).fail(function(fileName){
            console.warn("Can't find file: " + fileName);
         });
         
         return $defer.promise();
      }).always(function(){
         self.importedFiles.handlers = files;
      });
   };
   
   /**
    * Filter (match) hints by token passed as argument
    *
    * @param {Array<HintItem>} resources  Cached hint array list
    * @param {string}          token      Define what will be searching
    *
    * @return {Array<HintItem>} Filtered hints
    */
   SassHint.prototype._matchHints = function(resources, token){
      return $.map(resources, function(hint){
         var searchResult = StringMatch.stringMatch(hint.getName(), token, {preferPrefixMatches: true});
         if(searchResult){
            hint.matchGoodness = searchResult.matchGoodness;
            hint.stringRanges  = searchResult.stringRanges;
               
            return hint; 
         }
      });
   };
   
   /**
    * Update hints from current edited document
    *
    * @param {Object} cursor  Last cursor position
    * @param {number} type    Which group will be updated (recommended pass by hintModes const object)
    */
   SassHint.prototype._getLocalHints = function(cursor, type){
      if(cursor.line === this.cursorCache.line && this.lastHintMode === type){
         return;
      }
      
      var docText = DocumentManager.getCurrentDocument().getText();
      
      switch(type){
         case this.hintModes.VAR:
            // we have to clear local/private variables
            docText       = this._clearBlocks(docText);
            this.varLocal = this.varCache.concat(this._getVariables(docText));
            break;
         case this.hintModes.MIX:
            this.mixLocal = this.mixCache.concat(this._getMixins(docText).hints);
            break;
         case this.hintModes.FN:
            this.fnLocal = this.fnCache.concat(this._getFunctions(docText).hints);
            break;
      }
      
      this.lastHintMode = type;
   };
   
   /**
    * Replace fragment (range) text by new one.
    *
    * @param {string} text      Base text
    * @param {number} from      Start index
    * @param {number} to        End index
    * @param {string} newValue  Text which will be inserted into base text
    *
    * @return {string} Processed string
    */
   SassHint.prototype._stringReplaceRange = function(text, from, to, newValue){
      return text.slice(0, from) + newValue + text.slice(to);
   };
   
   /**
    * Find last close curly bracket "}" in text. Utility tools for get all function definition.
    *
    * @param {string|Array} text           The string to search for
    * @param {number}       startPosition  Optional. Offset
    * @param {boolean}      multiline      Optional. Split text to multiline
    *
    * @return {number} Position of bracket in text
    */
   SassHint.prototype._findCloseBracket = function(text, startPosition, multiline){
      var openBrackets = 0,
          bracketsExp  = /[{}]/g,
          matched      = null,
          lines        = 0;

      startPosition = parseInt(startPosition) || 0;
      multiline     = typeof multiline === "undefined" ? true : multiline;
      
      if(startPosition > 0 && typeof text === "string"){
         text = text.substr(startPosition);
      }
      
      if(!Array.isArray(text)){
         text = multiline ? text.split("\n") : [text];
      }

      // get length
      lines = text.length;

      for(var i = 0; i < lines; i++){
         while((matched = bracketsExp.exec(text[i])) !== null){
            if(matched[0] === "{"){
               openBrackets++;
               continue;
            }

            if(--openBrackets === 0){
               // one line function
               return i === 0 ? (startPosition + matched.index + 1) : (startPosition + text[i].length + i - matched.index);
            } 
         }

         startPosition += text[i].length;
      }

      return startPosition;
   };
   
   /**
    * Clear all function and mixin definition from text passed as argument. This help us clear local/private variables
    *
    * @param {string} text  Raw document text
    *
    * @return {string}  Filtered text without functions and mixins
    */
   SassHint.prototype._clearBlocks = function(text){
      var clearExp = /@(?:mixin|function)\s+(?:[^\{]*)\s*\{/g,
          match    = [],
          endIdx   = 0;
      
      while((match = clearExp.exec(text)) !== null){
         endIdx = this._findCloseBracket(text, match.index);
         text   = this._stringReplaceRange(text, match.index, endIdx, "");
            
         // back regexp index
         clearExp.lastIndex -= match[0].length;
      }
      
      return text;
   };
   
   /**
    * Get variables from text. Because SASS allow "redefine" variable we must ensure that we have only one definition 
    * of variable in hints result
    *
    * @param {string} text     Input text
    * @param {string} context  Optional. Name of file. Default local
    *
    * @return {Array<HintItem>}  List of uniques variable definitions
    */
   SassHint.prototype._getVariables = function(text, context){
      var match  = [],
          result = {}, // store in object to prevent duplicate variables
          key    = "";
      
      // set param default value
      context = context || "local";
      
      while((match = this.varRegExp.exec(text)) !== null){
         key = match[1] + context;
         
         // variables is defined chage details / value
         if(typeof result[key] !== "undefined"){
            result[key].setDetails(match[2]);
         } else {
            result[key] = new HintItem(match[1], match[2], 'V', context);
         }
      }

      return _.values(result);
   };
   
   /**
    * Get mixins from text
    *
    * @param {string}  text          Input text
    * @param {string}  context       Optional. Name of file. Default local
    * @param {boolean} overrideText  Optional. If true, it will return input text without mixin definitions (like _clearBlocks), 
    *                               otherwise return original text. Default false
    *
    * @return {Object}  List of uniques mixin definitions (hints) and processed or original text (text)
    */
   SassHint.prototype._getMixins = function(text, context, overrideText){
      var match  = [],
          result = [],
          endIdx = 0,
          hint;
      
      context      = context || "local";
      overrideText = !!overrideText;
      
      // search mixins
      while((match = this.mixRegExp.exec(text)) !== null){
         hint = new HintItem(match[1], "", 'M', context);
         
         if(typeof match[2] === "string"){
            hint.setParams(match[2]);
         }
         
         if(overrideText){
            endIdx = this._findCloseBracket(text, match.index);
            text   = this._stringReplaceRange(text, match.index, endIdx, "");
            
            // back regexp index
            this.mixRegExp.lastIndex -= match[0].length;
         }
         
         result.push(hint);
      }
      
      return { 
         'hints': result, 
         'text': text 
      };
   };

   /**
    * Get functions from text
    *
    * @param {string}  text          Input text
    * @param {string}  context       Optional. Name of file. Default local
    * @param {boolean} overrideText  Optional. If true, it will return input text without function definitions (like _clearBlocks), 
    *                               otherwise return original text. Default false
    *
    * @return {Object}  List of uniques function definitions (hints) and processed or original text (text)
    */
   SassHint.prototype._getFunctions = function(text, context, overrideText){
      var match     = [],
          result    = [],
          endIdx    = 0,
          hint;
      
      context  = context || "local";
      overrideText = !!overrideText;
      
      // search functions
      while((match = this.fnRegExp.exec(text)) !== null){
         hint = new HintItem(match[1], "", 'F', context);
         
         if(typeof match[2] === "string"){
            hint.setParams(match[2]);
         }
         
         if(overrideText){
            endIdx = this._findCloseBracket(text, match.index);
            text   = this._stringReplaceRange(text, match.index, endIdx, "");
            
            // reset inner index
            this.fnRegExp.lastIndex -= match[0].length;
         }
         
         result.push(hint);
      }
      
      return {
         'hints': result,
         'text': text
      };
   };
   
   /**
    * Register the HintProvider
    */
   AppInit.appReady(function(){
      var hints = new SassHint();
      
      var removeSaveListener = function(){
         if(!hasSaveListener) return;
         
         DocumentManager.off("documentSaved.sassHints", onDocumentSaved);
         hasSaveListener = false;
      };
      
      var onDocumentSaved = function(e, doc){
         hints.scanFiles(doc);
      };
      
      var onEditorEvent = function(e, editorFocus){
         if(editorFocus === null) {
            removeSaveListener();
            return false;
         }

         var langName = editorFocus.document.getLanguage().getId();
         if(fileExtensions.indexOf(langName) === -1) {
            removeSaveListener();
            return false;
         }
         
         // register save event to update file information
         if(!hasSaveListener){
            DocumentManager.on("documentSaved.sassHints", onDocumentSaved);
            hasSaveListener = true;
         }
         
         hints.clearCache();
         hints.setEditor(editorFocus);
         hints.init();
      };
      
      if(sassHintsEnabled){
         EditorManager.on("activeEditorChange.sassHints", onEditorEvent);
      }
      
      // load styles
      ExtensionUtils.loadStyleSheet(module, "styles/brackets-sass-hints.css");
      
      // add sass object to hint manager
      CodeHintManager.registerHintProvider(hints, fileExtensions, 1);
   });
});