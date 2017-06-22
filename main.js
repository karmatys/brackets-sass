/**
 * Copyright (C) 2017 Kamil Armatys
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

/*jshint plusplus: false, devel: false, nomen: true, indent: 4, maxerr: 50, regexp: true, strict: true, boss:true */
/*global define, brackets, $ */

define(function (require, exports, module) {
   "use strict";
   
   var AppInit            = brackets.getModule("utils/AppInit"),
       CodeHintManager    = brackets.getModule("editor/CodeHintManager"),
       Commands           = brackets.getModule("command/Commands"),
       CommandManager     = brackets.getModule("command/CommandManager"),
       KeyBindingManager  = brackets.getModule("command/KeyBindingManager"),
       Menus              = brackets.getModule("command/Menus"),
       EditorManager      = brackets.getModule("editor/EditorManager"),
       DocumentManager    = brackets.getModule("document/DocumentManager"),
       FileUtils          = brackets.getModule("file/FileUtils"),
       FileSystem         = brackets.getModule("filesystem/FileSystem"),
       StringMatch        = brackets.getModule("utils/StringMatch"),
       ExtensionUtils     = brackets.getModule("utils/ExtensionUtils"),
       Async              = brackets.getModule("utils/Async"),
       PreferencesManager = brackets.getModule("preferences/PreferencesManager"),
       BracketsStrings    = brackets.getModule("strings"),
       _                  = brackets.getModule("thirdparty/lodash");
       
   var HintItem             = require("HintItem"),
       ParameterHintManager = require("ParameterHintManager"),
       Strings              = require("i18n!nls/strings");
   
   // Import built-in sass functions
   var sassFunctions = JSON.parse(require("text!data/sass-functions.json"));
   
   // Command consts
   var KEY_BINDING      = "Ctrl-Shift-Space",
       SASS_FUNC_CMD_ID = "sassHints.showFunctionHints";
   
   // Store references to existing command
   var crrCmd, 
       crrCmdHandler,
       crrCmdFunction;
   
   // Preferences variables
   var commonLibPath    = "",
       maxHintNumber    = 50,
       showBuiltFns     = true,
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
   
   // Show built-in sass functions in hint list
   PreferencesManager.definePreference("sasscodehints.showBuiltFns", "boolean", true, {
      description: Strings.DESCRIPTION_SHOW_BUILT_FNS
   });
   
   PreferencesManager.on("change", "sasscodehints.maxHints", function(){
      maxHintNumber = parseInt(PreferencesManager.get("sasscodehints.maxHints"));
   });
   
   PreferencesManager.on("change", "sasscodehints.commonLibs", function(){
      commonLibPath = PreferencesManager.get("sasscodehints.commonLibs");
   });
   
   PreferencesManager.on("change", "sasscodehints.showBuiltFns", function(){
      showBuiltFns = !!PreferencesManager.get("sasscodehints.showBuiltFns");
   });
   
   PreferencesManager.on("change", "codehint.SassHint", function(){
      sassHintsEnabled = !!PreferencesManager.get("codehint.SassHint");
   });
   
   /**
    * Priority sort function for multiFieldSort method
   */
   function prioritySort(a, b){
      return b.priority - a.priority;
   }
   
   /**
    * @constructor
    */
   function SassHint() {
      
      // reference to current session editor
      this.crrEditor = null;
      
      this.cursorCache = {line: 0, ch: 0};
      
      // space for variable list
      this.varCache = [];
      
      // space for mixin list
      this.mixCache = [];
      
      // space for function list
      this.fnCache = [];
      
      // space for local and global variable list from current edited file
      this.vars = [];
      
      // space for global mixin list from current edited file
      this.mixins = [];
      
      // space for global function list from current edited file
      this.functions  = [];
      
      // sass built-in functions
      this.builtFns = [];
      
      // sass keywords
      this.keywords = ["import", "mixin", "extend", "function", "include", "media", "if", "return", "for", "each", "else", "while", "debug", "warn", "error", "at-root"];

      // css rules
      this.cssRules = ["charset", "namespace", "supports", "page", "font-face", "keyframes"];
      
      // imported files object
      this.importedFiles = {
         'names': [],
         'handlers': []
      };
      
      this.triggerHints = {
         "$": SassHint.hintModes.VAR, // start hinting session for variables
         "@": SassHint.hintModes.KEY, // start hinting session for sass keywords
      };
      
      // create parameter hint manager
      this.parameterManager = new ParameterHintManager();
      
      // define what is currently searched
      this.crrHintMode  = 0;
      this.lastHintMode = null;
      
      // expresion for variables, functions, mixins, ect.
      this.varRegExp     = /\$([A-Za-z0-9_\-]+):\s*([^\n;]+);/g;
      this.mixRegExp     = /@mixin\s+([A-Za-z0-9\-_]+)\s*(?:\(([^\{\(]*)\))?\s*\{/g;
      this.fnRegExp      = /@function\s+([A-Za-z0-9\-_]+)\s*\(([^\{\(]*)\)\s*\{/g;
      this.commentRegExp = /\/\*[^]*?(?:\*\/|$)|\/\/[^\n]*/g;
      
      // define, if new session is required
      this.newSession = false;
      
      // specify, whether function associated with existing command was overridden
      this.cmdOverriden = false;
      
      // prepare some properties
      this._init();
   }
   
   // const hint modes
   SassHint.hintModes = Object.freeze({
      "FN":  0,
      "MIX": 1,
      "VAR": 2,
      "KEY": 3
   });
   
   /**
    * Prepare object to work. This will be called only once, when instance will be created
    */
   SassHint.prototype._init = function(){
      var self = this,
          item;
      
      // prepare keywords
      this.keywords = this.keywords.map(function(key){
         item = new HintItem(key, "", "K", "keyword");
         item.setPriority(HintItem.priorities.medium);
         return item;
      });

      // prepare css rules
      this.cssRules.forEach(function(value){
         self.keywords.push(new HintItem(value, "", "K", "css keyword"));
      });

      // prepare built-in sass functions
      _.forEach(sassFunctions, function(value, key){
         self.builtFns.push(new HintItem(key, "(" + value.parameters + ")", "F", "sass"));
      });
      
      // check, if command is defined and associated with the same keys
      crrCmd = KeyBindingManager.getKeymap()[KEY_BINDING];
      if(typeof crrCmd !== "undefined"){
         crrCmdHandler  = CommandManager.get(crrCmd.commandID);
         crrCmdFunction = crrCmdHandler._commandFn;
      } else {
         this._registerCommands();
      }
   };
   
   /**
    * Prepare instance. This will be called whenever sass file will be opened
    */
   SassHint.prototype.init = function(){
      // scan current file in search of @import declarations
      this.scanFiles(this.crrEditor.document);
      
      // prepare parameter hint manager
      this.parameterManager.init(this.crrEditor);
      
      // join built-in functions if needed
      if(showBuiltFns && !this.fnCache.length){
         this.fnCache = this.fnCache.concat(this.builtFns);
      }
      
      // scan current file in search of vars, mixins and functions declarations
      this._updateAllHints(this.crrEditor.document.getText());
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
      var cursor, match, token;
      
      // check for explicit hint request
      if(implicitChar === null){
         var startChar = 0;
         cursor = editor.getCursorPos();

         // hint mode was changed in previous session
         if(this.crrHintMode !== null && this.newSession){
            this.cursorCache = this.cursorCache || cursor;
            this._updateHints(cursor, this.crrHintMode);
            this.newSession  = false;
            return true;
         }
         
         token = this._getToken(cursor, {line: cursor.line, ch: 0});
         match = /([$@][\w\-]*)\s*([\w\-]*)$/.exec(token);
         
         // nothing found
         if(!match){
            return false;
         }
         
         // maybe we should display mixins hint
         if(match[1] === "@include"){
            startChar = match[2].length;
            this.crrHintMode = SassHint.hintModes.MIX;
         } else {
            startChar = match[0].length-1;
            this.crrHintMode = this.triggerHints[match[1].charAt(0)];
         }
         
         this._updateHints(cursor, this.crrHintMode);
         
         this.cursorCache     = cursor;
         this.cursorCache.ch -= startChar;
         
         return true;
      }
      
      // hint request in standard mode
      if(typeof this.triggerHints[implicitChar] !== "undefined"){
         cursor = editor.getCursorPos();
         this.crrHintMode = this.triggerHints[implicitChar];
         
         this._updateHints(cursor, this.crrHintMode);
         
         this.cursorCache = cursor;
         this.crrEditor   = editor;
         
         return true;
      }
      
      // hint request in parameter mode
      if(implicitChar === "("){
         var source;
         
         cursor = editor.getCursorPos();
         source = this.getHintDataByParameterToken(this._getToken(cursor, {line: cursor.line, ch: 0}));
         
         if(!source) return false;
         
         this.parameterManager.openHint(source.name, source.hintList, cursor);
         return false;
      }
     
      this.crrHintMode = null;
      return false;
   };
   
   /**
    * Return a list of hints, for the current editor context
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
         this.crrHintMode = null;
         return false;
      }
      
      // get token from editor
      token = this._getToken(cursor);
      
      // hide parameters hint during this session
      this.parameterManager.hideHint();
      
      switch(this.crrHintMode){
         case SassHint.hintModes.VAR:
            hintsResult = this._matchHints(this.vars, token);
            break;
         
         case SassHint.hintModes.KEY:
            if(token === "include "){
              this.crrHintMode = SassHint.hintModes.MIX;
              return this.newSession = true;
            }
            hintsResult = this._matchHints(this.keywords, token);
            break;
         
         case SassHint.hintModes.MIX:
            if(implicitChar === " "){
               token = null;
               this.cursorCache.ch += 1;
            }
            
            hintsResult = this._matchHints(this.mixins, token);
            break;
            
         case SassHint.hintModes.FN:
            if(implicitChar === " "){
               token = null;
               this.cursorCache.ch += 1;
            }
            
            hintsResult = this._matchHints(this.functions, token);
            break;
      }
      
      if(hintsResult.length > maxHintNumber){
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
          start      = this.cursorCache,
          end        = this.crrEditor.getCursorPos();
      
      // when inserted hint is kind of function or mixin, then automatically opens parameters hint
      if(this.crrHintMode <= SassHint.hintModes.MIX){
         var hintParams = hint.find(".brackets-sass-hints-details").text();
         if(hintParams !== ""){
            this._insertCallable(insertText, hintParams, start, end);
            return keepHints;
         }
      }
      
      // insert hint and switch mode to mixin
      if(insertText === "include"){
         insertText += " ";
         
         this.cursorCache = null;
         this.crrHintMode = SassHint.hintModes.MIX;
         this.newSession  = keepHints = true;
      } else {
         this.crrHintMode = null;
      }
      
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
      this.lastHintMode  = null;
   };
   
   /**
    * Determines, if command (associated with the same keys) was detected and overridden.
    * It's possible to restore previous command function by #releaseCommands method
    *
    * @return {boolean} true, if command was overridden
   */
   SassHint.prototype.isCmdOverridden = function(){
      return typeof crrCmd !== "undefined";
   };
   
   /**
    * Override current command handler by own function
   */
   SassHint.prototype.overrideCommands = function(){
      if(this.cmdOverriden) return false;
      crrCmdHandler._commandFn = this._handleFunctionCmd.bind(this);
      this.cmdOverriden = true;
   };
   
   /**
    * Restore previous function which handles command
   */
   SassHint.prototype.restoreCommands = function(){
      if(!this.cmdOverriden) return false;
      crrCmdHandler._commandFn = crrCmdFunction;
      this.cmdOverriden = false;
   };
   
   /**
    * Provides specific data for parameters hint
    *
    * @param {string} token  Prepared fragment text which allow recognize function/mixin call
    *
    * @return {Object|boolean} False if given token is not recognized as a function (or mixin) or returns object 
    *                          with name and function/mixin hint array list
   */
   SassHint.prototype.getHintDataByParameterToken = function(token){
      var match = /(?:@include )?\b([a-zA-Z0-9_\-]+)\($/.exec(token);

      // nothing found
      if(!match){
         return false;
      }

      return {
         name:     match[1],
         hintList: match[0].charAt(0) === "@" ? this.mixins : this.functions 
      };
   };
   
   /**
    * Insert selected hint that is function (or mixin) name and automatically open parameter hint session
    *
    * @param {string} hintName     hint name
    * @param {string} hintDetails  hint parameters
    * @param {Object} start        start cursor position
    * @param {Object} end          end cursor position
    */
   SassHint.prototype._insertCallable = function(hintName, hintDetails, start, end){
      // insert text to editor
      this.crrEditor._codeMirror.replaceRange(hintName + "()", start, end);
      
      // move cursor back 1 char
      start.ch = end.ch + hintName.length + (start.ch - end.ch) + 1;
      this.crrEditor.setCursorPos(start);
      
      // open parameters hint
      this.parameterManager.openHint(hintName, hintDetails, start);
      this.crrHintMode = null;
   };
   
   /**
    * Get token from specified range
    *
    * @param {Object} currentCursor  Current cursor position (end of range)
    * @param {Object} startCursor    Optional. If this parameter is omitted, cached cursor will be used
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
      StringMatch.multiFieldSort(hints, ["matchGoodness", prioritySort, "name"]);
      
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
      
      // clear names, prepare array for store file handlers
      files = [];
      
      // join built-in functions if needed
      if(showBuiltFns){
         this.fnCache = this.fnCache.concat(this.builtFns);
      }
      
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
               var hintResult = {};
               
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
   SassHint.prototype._updateHints = function(cursor, type){
      if(cursor.line === this.cursorCache.line && this.lastHintMode === type){
         return;
      }

      var source;
      
      switch(type){
         case SassHint.hintModes.VAR:
            // find local/private variables
            source = this._getLocalVariables(this.crrEditor, cursor, true);
            
            // join local and global variables
            this.vars = this.varCache.concat(source.vars, this._getVariables(source.text));
            break;
         case SassHint.hintModes.MIX:
            // get global mixins
            source = this._removeComments(this.crrEditor.document.getText(), false);
            
            // join with cached mixins
            this.mixins = this.mixCache.concat(this._getMixins(source).hints);
            break;
         case SassHint.hintModes.FN:
            // get global functions from current editor
            source = this._removeComments(this.crrEditor.document.getText(), false);
            
            // join with cached functions
            this.functions = this.fnCache.concat(this._getFunctions(source).hints);
            break;
      }
      
      this.lastHintMode = type;
   };
   
   /**
    * Update all kind of hints from text given as argument
    *
    * @param {string} docText  source of code, which will be scanned
   */
   SassHint.prototype._updateAllHints = function(docText){
      var hintResult = {};
               
      // remove comments
      docText = docText.replace(this.commentRegExp, "");

      // get functions from file
      hintResult     = this._getFunctions(docText, null, true);
      this.functions = this.fnCache.concat(hintResult.hints);

      // get mixins from file
      hintResult  = this._getMixins(hintResult.text, null, true);
      this.mixins = this.mixCache.concat(hintResult.hints);

      // get variables from file
      this.vars = this.varCache.concat(this._getVariables(hintResult.text, null));
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
    * @param {string}  text           The string to search for
    * @param {number}  startPosition  Optional. Offset
    *
    * @return {number} Position of bracket in text
    */
   SassHint.prototype._findCloseBracket = function(text, startPosition){
      var openBrackets = 0,
          bracketsExp  = /[{}]/g,
          matched      = null;

      startPosition = parseInt(startPosition) || 0;
      
      if(startPosition > 0 && typeof text === "string"){
         text = text.substr(startPosition);
      }
      
      while((matched = bracketsExp.exec(text)) !== null){
         if(matched[0] === "{"){
            openBrackets++;
            continue;
         }

         if(--openBrackets === 0){
            return startPosition + matched.index + 1;
         } 
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
    * Analyze document for search local variables based on cursor position
    *
    * @param {Editor}  editor        The current editor context
    * @param {Object}  cursor        Cursor position
    * @param {boolean} overrideText  Optional. If true, it will return input text without any block definitions (works like _clearBlocks), 
    *                                otherwise return original text. Default false
    *
    * @return {Object} Local variables and processed input text
    */
   SassHint.prototype._getLocalVariables = function(editor, cursor, overrideText){
      var targetExp  = /@(?:mixin|function)\s+(?:[^\{]*)\s*\{/g,
          match      = [],
          localVars  = [],
          curFlatPos = 0,
          docText    = "";
      
      var blockCoords = [],
          block       = {};
      
      // helper vars
      var endIdx = 0;
      
      // cast optional param to bool
      overrideText = !!overrideText;
      
      // get "flat" cursor position
      docText    = this._removeComments(editor.document.getRange({line: 0, ch: 0}, cursor), false);
      curFlatPos = docText.length;
      
      // join rest of document
      endIdx   = editor.getLastVisibleLine();
      docText += this._removeComments(editor.document.getRange(cursor, {line: endIdx}), false);
      
      // find all mixins and functions coordinates
      while((match = targetExp.exec(docText)) !== null){
         block = {
            head:  match.index,
            start: match.index + match[0].length,
            end:   this._findCloseBracket(docText, match.index)
         };
         
         blockCoords.push(block);
      }
      
      // get local variable if cursor is inside the block
      if((endIdx = this._inBlock(blockCoords, curFlatPos)) !== -1){
         var blockBody = docText.substring(blockCoords[endIdx].head, blockCoords[endIdx].end);
         
         localVars = this._findLocalVariables(blockBody, {
            head:  0,
            start: blockCoords[endIdx].start - blockCoords[endIdx].head,
            end:   blockCoords[endIdx].end - blockCoords[endIdx].head
         }, curFlatPos - blockCoords[endIdx].start);
      }

      // remove block definitions if needed
      if(overrideText && blockCoords.length > 0){
         // offset does not be calculated for first element
         docText = this._stringReplaceRange(docText, blockCoords[0].head, blockCoords[0].end, "");
         endIdx  = blockCoords[0].end - blockCoords[0].head;
         
         for(var i = 1; i< blockCoords.length; i++){
            // need update block coordinates, after remove first part of text
            docText  = this._stringReplaceRange(docText, blockCoords[i].head - endIdx, blockCoords[i].end - endIdx, "");
            endIdx  += blockCoords[i].end - blockCoords[i].head;
         }
      }

      return {
         text: docText,
         vars: localVars
      };
   };
   
   /**
    * Indicates whether cursor is inside the block (function/mixin) or not. If yes, it return its index to block definition, otherwise 
    * return -1. This method is based on binary search.
    *
    * @param {Array<Object>} coords - coordinates to all blocks (functions/mixins) in document
    * @param {number} cursorPos - cursor position
    *
    * @return {number} - index position or -1
   */
   SassHint.prototype._inBlock = function(coords, cursorPos){
      var left   = 0, 
          middle = 0,
          right  = coords.length-1;
      
      while(left <= right){
         middle = (left+right) >> 1;
         
         if(cursorPos >= coords[middle].start && cursorPos <= coords[middle].end){
            return middle;
         }
         
         if(coords[middle].start < cursorPos){
            left = middle + 1;
         }else{
            right = middle - 1;
         }
      }
      
      return -1;
   };
   
   /**
    * Find parameters and variables in local scope
    *
    * @param {string}  text         Input text (block body)
    * @param {Object}  localCoords  Coordinates that indicates on function/mixin definition. Values should be related to 
    *                               input text what means shift from global to local scope
    * @param {number}  localCursor  Optional. "Flat" cursor position (without division on lines). Default 0
    *
    * @return {Array<HintItem>} Unique local variables and parameters
    */
   SassHint.prototype._findLocalVariables = function(text, localCoords, localCursor){
      var argsExp = /\$([\w\-]+)(?::[\t ]*([^,\)\s]+))?/g,
          args    = [],
          vars    = [],
          params  = {};
      
      var def     = "",
          key     = "",
          vkey    = "",
          hintObj;
      
      localCursor = localCursor || 0;
      
      // get function/mixin definition
      def = text.substring(localCoords.head, localCoords.start);
      
      // find parameters
      while((args = argsExp.exec(def)) !== null){
         hintObj = new HintItem(args[1], "", "P", "local");
         hintObj.setPriority(HintItem.priorities.high);
         
         if(args[2]){
            hintObj.setDetails(args[2]);
         }
         
         params[args[1]] = hintObj;
      }
      
      vars = this._getVariables(text, "local", HintItem.priorities.medium, true);
      
      // join unique variables from body
      for(key in params){
         vkey = key + "local";
         if(vars.hasOwnProperty(vkey)){
            params[key].setDetails(vars[vkey].getDetails());
            delete vars[vkey];
         } 
         
         vars[key] = params[key];
      }
      
      return _.values(vars);
   };
   
   /**
    * Remove all comments from given text
    *
    * @param {string}  text       Input text
    * @param {boolean} keepLines  Optional. When true, comments will be replaced by new line character, 
    *                             thus number of lines in editor will not change. Default false
    *
    * @return {string} Text without any comments (inline or multiline)
    */
   SassHint.prototype._removeComments = function(text, keepLines){
      return (keepLines === false) ? 
         text.replace(this.commentRegExp, "") :
         text.replace(this.commentRegExp, function(fullMatch){
            // single-line comment
            if(fullMatch.charAt(1) === "/") return "";
            
            // multi-line comment
            return "\n".repeat(fullMatch.split("\n").length-1);
         });
   };
   
   /**
    * Get variables from text. Because SASS allow "redefine" variable we must ensure that we have only one definition 
    * of variable in hints result
    *
    * @param {string}  text            Input text
    * @param {string}  context         Optional. Name of file. Default global
    * @param {number}  priority        Optional. Priority for hints. This affects on display order. Default low (0)
    * @param {boolean} returnAsObject  Optional. When true, object will not be converted to simple array. Default false
    *
    * @return {Array<HintItem>|Object} List of uniques variable definitions
    */
   SassHint.prototype._getVariables = function(text, context, priority, returnAsObject){
      var match  = [],
          result = {}, // store in object to prevent duplicate variables
          key    = "";
      
      // set param default value
      context  = context || "global";
      priority = priority || 0;
      
      while((match = this.varRegExp.exec(text)) !== null){
         key = match[1] + context;
         
         // variables is defined chage details / value
         if(typeof result[key] !== "undefined"){
            result[key].setDetails(match[2]);
         } else {
            result[key] = new HintItem(match[1], match[2], 'V', context);
            result[key].setPriority(priority);
         }
      }

      return (!!returnAsObject) ? result : _.values(result);
   };
   
   /**
    * Get mixins from text
    *
    * @param {string}  text          Input text
    * @param {string}  context       Optional. Name of file. Default local
    * @param {boolean} overrideText  Optional. If true, it will return input text without mixin definitions (like _clearBlocks), 
    *                                otherwise return original text. Default false
    *
    * @return {Object}  List of uniques mixin definitions (hints) and processed or original text (text)
    */
   SassHint.prototype._getMixins = function(text, context, overrideText){
      var match  = [],
          result = [],
          endIdx = 0,
          hint;
      
      context      = context || "global";
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
    *                                otherwise return original text. Default false
    *
    * @return {Object}  List of uniques function definitions (hints) and processed or original text (text)
    */
   SassHint.prototype._getFunctions = function(text, context, overrideText){
      var match     = [],
          result    = [],
          endIdx    = 0,
          hint;
      
      context  = context || "global";
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
    * Handles hint request invoked by command manager. First it checks, whether parameters hint session should
    * be opened, if not it tries to open function hint session
   */
   SassHint.prototype._handleFunctionCmd = function(){
      var cursorPos  = this.crrEditor.getCursorPos(),
          inputToken = this._getToken(cursorPos, {line: cursorPos.line, ch:0}),
          self       = this;
      
      // look for a parameters hint first
      var paramState = this.parameterManager.handleParametersCmd(function(token){
         return self.getHintDataByParameterToken(token);
      }, cursorPos, inputToken);
      
      // nothing found, show functions hint list
      if(!paramState){
         var match = inputToken.match(/(?:^|\s)([a-zA-Z0-9_\-]+)$/);
         
         if(match && match[1] !== ""){
            cursorPos.ch -= match[1].length;
         }
         
         // create new hint session
         this.cursorCache = cursorPos;
         this.newSession  = true;
         this.crrHintMode = SassHint.hintModes.FN;
         
         // execute CodeHintMamanger command
         CommandManager.execute(Commands.SHOW_CODE_HINTS);
      }
   };
   
   /**
    * Register commands in brackets and create menu item
   */
   SassHint.prototype._registerCommands = function(){
      var menu = Menus.getMenu(Menus.AppMenuBar.EDIT_MENU),
          self = this;
      
      // register the command handler
      CommandManager.register(BracketsStrings.CMD_SHOW_PARAMETER_HINT, SASS_FUNC_CMD_ID, this._handleFunctionCmd.bind(this));
      
      // Add the menu items
      if (menu) {
          menu.addMenuItem(SASS_FUNC_CMD_ID, KEY_BINDING, Menus.AFTER, Commands.SHOW_CODE_HINTS);
      }

      // Close the function hint when commands are executed, except for the commands
      // to show function hints for code hints.
      CommandManager.on("beforeExecuteCommand", function (event, commandId) {
         if (commandId !== SASS_FUNC_CMD_ID) {
            self.parameterManager.closeHint();
         }
      });
   };
   
   /**
    * Register the HintProvider
    */
   AppInit.appReady(function(){
      var hints = new SassHint();
      
      // workaround for sharing key binding with js parameter hint (built-in extension)
      var removeSaveListener = (function(){
         return hints.isCmdOverridden() ?
            function(){
               if(!hasSaveListener) return;
               DocumentManager.off("documentSaved.sassHints", onDocumentSaved);
               hints.restoreCommands();
               hasSaveListener = false;
            }
            : function(){
               if(!hasSaveListener) return;
               DocumentManager.off("documentSaved.sassHints", onDocumentSaved);
               hasSaveListener = false;
            };
      })();
      
      var addSaveListener = (function(){
         return hints.isCmdOverridden() ?
            function(){
               DocumentManager.on("documentSaved.sassHints", onDocumentSaved);
               hints.overrideCommands();
               hasSaveListener = true;
            }
            : function(){
               DocumentManager.on("documentSaved.sassHints", onDocumentSaved);
               hasSaveListener = true;
            };
      })();
      
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
            addSaveListener();
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
      CodeHintManager.registerHintProvider(hints, fileExtensions, 2);
      
      // for unit tests
      exports.sassHintProvider = hints;
   });
});