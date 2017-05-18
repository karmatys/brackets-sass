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
       * @param {number} line - editor line (index start at 0)
       * @param {number} ch - character position (index start at 0)
       */
      function setCursorPos(line, ch){
         line = (line < 0) ? testEditor.getLastVisibleLine() + line : line;
         testEditor.setCursorPos({"line": line, "ch": ch || 0});
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
      
      describe("SassHint instance", function(){
         it("built-in functions included successfully", function(){
            expect(SassHint.sassHintProvider.builtFns.length).toBe(78);
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
            testDocument.replaceRange("@import 'import-content.scss';\n", {line: 1, ch:0});
            
            // emulate activeEditorChange event async
            runs(function(){
               SassHint.sassHintProvider.clearCache();
               SassHint.sassHintProvider.setEditor(testEditor);
               SassHint.sassHintProvider.init();
               
               // wait for document loading
               setTimeout(function(){
                  complete = true;
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
         
         it("should display all functions without built-ins [global 3][imported 1]", function(){
            setCursorPos(-1, 0);
            expect(getHints(SassHint.sassHintProvider, ":").length).toBe(4);
         });
         
         it("should display imported function", function(){
            testDocument.replaceRange(": pxto", {line: 8, ch: 0});
            setCursorPos(8, 6);
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
            setCursorPos(-1, 0);
            expect(getHints(SassHint.sassHintProvider, "$").length).toBe(4);
         });
         
         it("should display all global mixins [3]", function(){
            testDocument.replaceRange("@include ", {line: 1, ch: 0});
            setCursorPos(1, 9);
            
            // switch from keywords hint to mixin
            getHints(SassHint.sassHintProvider, null);
            
            // get mixin hints
            expect(getHints(SassHint.sassHintProvider, null).length).toBe(3);
         });
         
         it("should display filtered mixin without switch from keywords mode", function(){
            setCursorPos(62, 17);
            equalHints(SassHint.sassHintProvider, null, ["clearfix"]);
         });
         
         it("should not display any hints", function(){
            testDocument.replaceRange("c", {line: 8, ch: 0});
            setCursorPos(8, 1);
            expectNoHints(SassHint.sassHintProvider, null);
         });
         
         it("should not display any VARIABLE hints", function(){
            testDocument.replaceRange("$cc", {line: 8, ch: 0});
            setCursorPos(8, 3);
            expect(getHints(SassHint.sassHintProvider, null).length).toBe(0);
         });
         
         xit("should display parametrs and local variables", function(){
            testDocument.replaceRange("$\n", {line: 15, ch: 3});
            setCursorPos(15, 3);
            includeHints(SassHint.sassHintProvider, null, ["a", "b", "c", "result"]);
         });
         
         it("should filter variable hints by query", function(){
            testDocument.replaceRange("$s", {line: 8, ch: 0});
            setCursorPos(8, 2);
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
            
            expect(getHints(SassHint.sassHintProvider, ":").length).toBe(3);
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