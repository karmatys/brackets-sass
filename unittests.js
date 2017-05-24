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
/*global define, brackets, describe, it, xit, expect, beforeEach, afterEach, beforeFirst, afterLast, waitsFor, runs */

define(function (require, exports, module) {
   "use strict";
   
   // brackets modules
   var SpecRunnerUtils    = brackets.getModule("spec/SpecRunnerUtils"),
       PreferencesManager = brackets.getModule("preferences/PreferencesManager"),
       FileUtils          = brackets.getModule("file/FileUtils");
   
   // local modules and content
   var SassHint    = require('main'),
       testContent = require('text!unittest-files/test-content.scss');
   
   // get path to extension
   var extensionPath   = FileUtils.getNativeModuleDirectoryPath(module);
   
   describe("Sass Code Hinting", function(){
      var mock,
          testDocument,
          testEditor;
      
      /**
       * Modify brackets preferences and reinit hint provider if test editor exists
       *
       * @param {string|Object} name - name of preference if you want to change only one value or object in form {name: value}.
       *                               the names should be given without prefix "sasscodehints"
       * @param {string|number|null} value - new value of given preference
       */
      function setPreference(name, value){
         if(typeof name === "string"){
            PreferencesManager.set("sasscodehints." + name, value);
         } else{
            for (var key in name){
               if(name.hasOwnProperty(key)){
                  PreferencesManager.set("sasscodehints." + key, name[key]);
               }
            }
         }
         
         // reinit sass provider if editor exists
         if(!!testEditor){
            SassHint.sassHintProvider.clearCache();
            SassHint.sassHintProvider.setEditor(testEditor);
            SassHint.sassHintProvider.init();
         }
      }
      
      /**
       * Set cursor position in current editor. If line number is negative, function will set line from the end
       * 
       * @param {number} line - editor line (index start at 1)
       * @param {number} ch - character position (index start at 1)
       */
      function setCursorPos(line, ch){
         ch   = ch || 1;
         line = (line < 0) ? testEditor.getLastVisibleLine() + line + 1 : line - 1;
         testEditor.setCursorPos({"line": line, "ch": ch-1});
      }
      
      /**
       * Insert text into document
       *
       * @param {string} text - text to insert
       * @param {number} line - editor line (index start at 1)
       * @param {number} ch - character position (index start at 1)
      */
      function insertText(text, line, ch){
         ch = ch || 1;
         line = (line < 0) ? testEditor.getLastVisibleLine() + line + 1 : line - 1;
         testDocument.replaceRange(text, {"line": line, ch: ch-1});
      }
      
      /**
       * Return index element if exists in hint list or -1
       * 
       * @param  {Array<jQuery>} hintArray - hint list from provider
       * @param  {string} text - searched element
       * @return {number} - index of element if found, otherwise -1
       */
      function _indexOf(hintArray, text){
         var length = hintArray.length,
             index  = -1,
             i;
         
         for(i = 0; i < length; i++){
            if(hintArray[i].data("token") === text){
               index = i;
               break;
            }
         }
         
         return index;
      }
      
      /**
       * Get hint list from current cursor position
       * 
       * @param {SassHint} provider - a CodeHintProvider object.
       * @param {string} key - optional, determine type of hint list (variables, functions, ect.)
       * @return {Array<jQuery>} - hint list, each one is at jQuery object form
       */
      function getHints(provider, key){
         key = key || null;
         expect(provider.hasHints(testEditor, key)).toBe(true);
         return provider.getHints(null).hints;
      }
      
      /**
       * Ask provider for hint list and expect it not to return any
       * 
       * @param {SassHint} provider - a CodeHintProvider object.
       * @param {string} key - optional, determine type of hint list (variables, functions, ect.)
       */
      function expectNoHints(provider, key){
         key = key || null;
         expect(provider.hasHints(testEditor, key)).toBe(false);
      }
      
      /**
       * Expect that elements from list are exactly the same as in hint response object
       * 
       * @param {SassHint} provider - a CodeHintProvider object
       * @param {string} key - optional, determine type of hint list (variables, functions, ect.)
       * @param {Array<string>} list - a list of hint that must be present in hint result. 
       */
      function equalHints(provider, key, list){
         var hintList = getHints(provider, key),
             hintItem;
         
         expect(hintList.length).toBe(list.length);         
         hintList.forEach(function(value, index){
            hintItem = value.data("token");
            expect(hintItem).toBe(list[index]);
         });
      }
      
      /**
       * Expect that elements from list are present in hint response object
       * 
       * @param {SassHint} provider - a CodeHintProvider object.
       * @param {string} key - optional, determine type of hint list (variables, functions, ect.)
       * @param {Array<string>} list - a list of hint that must be present in hint result
       */
      function includeHints(provider, key, list){
         var hintList = getHints(provider, key);
         if(typeof hintList === "undefined") return false;

         list.forEach(function(value){
            expect(_indexOf(hintList, value)).not.toBe(-1);
         });
      }
      
      /**
       * Expect that elements from list are absent in hint response object
       * 
       * @param {SassHint} provider - a CodeHintProvider object.
       * @param {string} key - optional, determine type of hint list (variables, functions, ect.)
       * @param {Array<string>} list - a list of hint that are absent in hint result
       */
      function notIncludeHints(provider, key, list){
         var hintList = getHints(provider, key);
         if(typeof hintList === "undefined") return false;

         list.forEach(function(value){
            expect(_indexOf(hintList, value)).toBe(-1);
         });
      }
      
      /**
       * Check performance for given function
       *
       * @param {number}   iteration - number of iterations
       * @param {Function} fn - function to test
       *
       * @return {number} - elapsed time (in miliseconds)
      */
      function performanceTest(iteration, fn){
         var start, i;

         start = performance.now();
         for(i=0; i<iteration; i++){
            fn();
         }

         return (performance.now() - start);
      }
      
      describe("SassHint instance", function(){
         var sass, text;

         beforeFirst(function(){
            // create dummy editor
            mock = SpecRunnerUtils.createMockEditor(testContent, "scss");
            testDocument = mock.doc;
            testEditor   = mock.editor;

            // create shortcuts
            sass = SassHint.sassHintProvider;
            text = testDocument.getText();

            // emulate activeEditorChange event
            SassHint.sassHintProvider.clearCache();
            SassHint.sassHintProvider.setEditor(testEditor);
            SassHint.sassHintProvider.init();
         });

         afterLast(function(){
            // destroy editor
            SpecRunnerUtils.destroyMockEditor(testDocument);
            testEditor   = null;
            testDocument = null;
         });

         it("built-in functions included successfully", function(){
            expect(SassHint.sassHintProvider.builtFns.length).toBe(78);
         });

         it("method _findCloseBrackets work successfully", function(){
            var startAt = testEditor.indexFromPos({line: 15, ch: 0}),
                endAt   = testEditor.indexFromPos({line: 18, ch: 1});

            // multiline function
            expect(sass._findCloseBracket(text, startAt)).toBe(endAt);

            // inline function
            startAt = testEditor.indexFromPos({line: 27, ch: 0});
            endAt   = testEditor.indexFromPos({line: 27, ch: 53});
            expect(sass._findCloseBracket(text, startAt)).toBe(endAt);

            // mixin
            startAt = testEditor.indexFromPos({line: 54, ch: 0});
            endAt   = testEditor.indexFromPos({line: 65, ch: 1});
            expect(sass._findCloseBracket(text, startAt)).toBe(endAt);
         });
      });
      
      describe("Editor hinting test with @import", function(){
         beforeFirst(function(){
            setPreference({"commonLibs": extensionPath + "/unittest-files/", "showBuiltFns": false});
         });
         
         afterLast(function(){
            setPreference({"commonLibs": "", "showBuiltFns": true});
         });
         
         beforeEach(function() {
            var complete = false;
            
            // create dummy editor
            mock = SpecRunnerUtils.createMockEditor(testContent, "scss");
            testDocument = mock.doc;
            testEditor   = mock.editor;
            
            // insert @import
            insertText("@import 'import-content.scss';\n", 4);
            
            // emulate activeEditorChange event async
            runs(function(){
               SassHint.sassHintProvider.clearCache();
               SassHint.sassHintProvider.setEditor(testEditor);
               SassHint.sassHintProvider.init();
               
               // wait for document loading
               setTimeout(function loadingDone(){
                  if(SassHint.sassHintProvider.importedFiles.handlers.length > 0){
                     complete = true;
                  }
                  
                  setTimeout(loadingDone, 50);
               }, 50);
            });
            
            waitsFor(function(){ return complete; });
         });

         afterEach(function() {
            // destroy editor
            SpecRunnerUtils.destroyMockEditor(testDocument);
            testEditor   = null;
            testDocument = null;
         });
         
         it("should display all variables [global 4][imported 1]", function(){
            setCursorPos(-1, 0);
            expect(getHints(SassHint.sassHintProvider, "$").length).toBe(5);
         });
         
         it("should display all functions without built-ins [global 6][imported 1]", function(){
            setCursorPos(-1, 0);
            expect(getHints(SassHint.sassHintProvider, ":").length).toBe(7);
         });
         
         it("should display imported function", function(){
            testDocument.replaceRange(": pxto", {line: 8, ch: 0});
            insertText(": pxto", -3, 4);
            setCursorPos(-3, 10);
            includeHints(SassHint.sassHintProvider, null, ["pxtoem"]);
         });
         
      });
      
      describe("Editor hinting test without @import", function(){
         beforeEach(function() {
            // create dummy editor
            mock = SpecRunnerUtils.createMockEditor(testContent, "scss");
            testDocument = mock.doc;
            testEditor   = mock.editor;
            
            // emulate activeEditorChange event
            SassHint.sassHintProvider.clearCache();
            SassHint.sassHintProvider.setEditor(testEditor);
            SassHint.sassHintProvider.init();
         });

         afterEach(function() {
            // destroy editor
            SpecRunnerUtils.destroyMockEditor(testDocument);
            testEditor   = null;
            testDocument = null;
         });
         
         it("should display all global variables [4]", function(){
            setCursorPos(-1);
            expect(getHints(SassHint.sassHintProvider, "$").length).toBe(4);
         });
         
         it("should display all global mixins [3]", function(){
            insertText("@include ", 10);
            setCursorPos(10, 10);
            
            // switch from keywords hint to mixin
            getHints(SassHint.sassHintProvider, null);
            
            // get mixin hints
            expect(getHints(SassHint.sassHintProvider, null).length).toBe(3);
         });
         
         it("should display filtered mixin without switch from keywords mode", function(){
            setCursorPos(77, 18);
            equalHints(SassHint.sassHintProvider, null, ["clearfix"]);
         });
         
         it("should not display any hints", function(){
            insertText("c", 10);
            setCursorPos(10, 2);
            expectNoHints(SassHint.sassHintProvider, null);
         });
         
         it("should not display any VARIABLE hints", function(){
            insertText("$cc", 10);
            setCursorPos(10, 4);
            
            // hasHint should return true, but getHints should not match anything
            expect(getHints(SassHint.sassHintProvider, null).length).toBe(0);
         });
         
         it("should not display VARIABLE defined inside comment, even if cursor is inside it", function(){
            setCursorPos(72, 4);
            
            // hasHint should return true, but getHints should not match anything
            notIncludeHints(SassHint.sassHintProvider, "$", ["black"]);
         });
         
         it("should display parametrs and local variables", function(){
            insertText("$\n", 17, 4);
            setCursorPos(17, 5);
            includeHints(SassHint.sassHintProvider, null, ["a", "b", "c", "result"]);
         });
         
         it("should display parametrs inside inline function", function(){
            setCursorPos(28, 38);
            includeHints(SassHint.sassHintProvider, "$", ["a", "b"]);
         });
         
         it("should filter variable hints by query", function(){
            insertText("$s", 10);
            setCursorPos(10, 3);
            equalHints(SassHint.sassHintProvider, null, ["sizeA", "sizeB"]);
         });
         
         it("should display all keywords", function(){
            var keywordsLength = SassHint.sassHintProvider.keywords.length;
            setCursorPos(-1, 0);
            expect(getHints(SassHint.sassHintProvider, "@").length).toBe(keywordsLength);
         });
         
         it("should display all functions with built-ins", function(){
            setCursorPos(-1, 0);
            expect(getHints(SassHint.sassHintProvider, ":").length).toBeGreaterThan(3);
         });
         
         it("should display all functions without built-ins", function(){
            setPreference("showBuiltFns", false);
            setCursorPos(-1, 0);
            
            expect(getHints(SassHint.sassHintProvider, ":").length).toBe(6);
            setPreference("showBuiltFns", true);
         });
         
         it("should display limited hint list [max 10]", function(){
            setPreference("maxHints", 10);
            setCursorPos(-1, 0);
            
            expect(getHints(SassHint.sassHintProvider, ":").length).not.toBeGreaterThan(10);
            setPreference("maxHints", 50);
         });
      });
   });
});