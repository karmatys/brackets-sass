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

/*jshint plusplus: false, devel: true, nomen: true, indent: 4, maxerr: 50, regexp: true, strict: true */
/*global define, brackets, $ */

define(function (require, exports, module) {
   "use strict";
   
   var Commands          = brackets.getModule("command/Commands"),
       CommandManager    = brackets.getModule("command/CommandManager"),
       KeyBindingManager = brackets.getModule("command/KeyBindingManager"),
       Menus             = brackets.getModule("command/Menus"),
       KeyEvent          = brackets.getModule("utils/KeyEvent"),
       Strings           = brackets.getModule("strings"),
       _                 = brackets.getModule("thirdparty/lodash");
   
   var hintBody = "<div id=\"function-hint-container\" class=\"brackets-sass-param\"><div class=\"function-hint-content\"></div></div>";
   
   var KEY_BINDING       = "Ctrl-Shift-Space",
       SASS_PARAM_CMD_ID = "sassHints.showParameterHint";
   
   var crrCmd, 
       crrCmdHandler,
       crrCmdFunction;
   
   /**
    * @constructor
   */
   function ParameterHintManager(){
      this.hintStack   = [];
      this.visible     = false;
      this.active      = false;
      this.cmdReleased = true;
      this.dataHandler = null;
      this.editor      = null;
      
      this.hintName   = "";
      this.hintParams = "";
      this.token      = "";
      
      this.startCursor = {};
      
      this.$hintContainer = null;
      this.$hintContent   = null;
      
      this._init();
   }
   
   ParameterHintManager.prototype._init = function(){
      // prepare handlers from editor
      this.$hintContainer = $("body").find("#function-hint-container");
      
      if(this.$hintContainer.length < 0){
         this.$hintContainer = $(hintBody).appendTo($("body"));
      }
      
      this.$hintContent = this.$hintContainer.children().first();
      
      // get command
      crrCmd = KeyBindingManager.getKeymap()[KEY_BINDING];
      if(typeof crrCmd !== "undefined"){
         crrCmdHandler  = CommandManager.get(crrCmd.commandID);
         crrCmdFunction = crrCmdHandler._commandFn;
      } else {
         this._registerCommands();
      }
   };
   
   ParameterHintManager.prototype.init = function(editor){
      // set editor for events later
      this.editor  = editor;
   };
   
   ParameterHintManager.prototype.isActive = function(){
      return this.active;
   };
   
   ParameterHintManager.prototype.isVisible = function(){
      return this.visible;
   };
   
   ParameterHintManager.prototype.isCmdOverridden = function(){
      return typeof crrCmd !== "undefined";
   };
   
   ParameterHintManager.prototype.setDataForHintRequest = function(fn){
      this.dataHandler = fn;
   };
   
   /**
    *
    */
   ParameterHintManager.prototype.openHint = function(hintName, hintParams, cursor, token){
      // params are not given, we have to find them by hint name
      if(Array.isArray(hintParams)){
         hintParams = this._findParams(hintName, hintParams);
         
         // definition not found
         if(hintParams === -1){
            return false;
         }   
      }
      
      var hintPos = this.editor._codeMirror.charCoords({line: cursor.line, ch: cursor.ch - 1});
      
      // store hint details
      this.startCursor = cursor;
      this.hintName    = hintName;
      this.hintParams  = (hintParams === "()") ? Strings.NO_ARGUMENTS : hintParams.slice(1, -1).split(",");
      this.token       = token || "";
      
      // add listeners
      this._addListeners();
      
      // show hints
      this._popupHint();
      
      // set position
      this._positionHint(hintPos.left, hintPos.top, hintPos.bottom);
   };
   
   ParameterHintManager.prototype.closeHint = function(){
      if(!this.active) return true;
                            
      this.$hintContainer.hide();
      this.$hintContent.empty();
      this._removeListeners();
      
      this.active = this.visible = false;
      
      return true;
   };
   
   ParameterHintManager.prototype.showHint = function(){
      if(!this.active && this.visible) return false;
      
      this.$hintContainer.show();
      return this.visible = true;
   };
   
   ParameterHintManager.prototype.hideHint = function(){
      if(!this.active && !this.visible) return false;
      
      this.$hintContainer.hide();
      this.visible = false;
      return true;
   };
   
   ParameterHintManager.prototype._formatHints = function(source){
      if(typeof source === "string"){
         return _.escape(source);
      }
      
      var crrIndex   = this.token.split(",").length - 1,
          result     = [];
      
      result = source.map(function(elem, index){
         if(index === crrIndex){
            return "<span class=\"current-parameter\">" + _.escape(elem) + "</span>";
         } else{
            return _.escape(elem);
         }
      });
      
      return result.join(",");
   };
   
   ParameterHintManager.prototype._popupHint = function(){
      var hintText = "";
      
      // clear previous hint content
      this.$hintContent.empty();
      this.$hintContent.addClass('brackets-sass-phm');
      
      // get formated hint content
      hintText = this._formatHints(this.hintParams);
      
      // append to editor
      this.$hintContent.append(hintText);
      this.$hintContainer.show();
      
      this.active = this.visible = true;
   };
   
   /**
     * Position a function hint.
     *
     * @param {number} xpos
     * @param {number} ypos
     * @param {number} ybot
    */
   ParameterHintManager.prototype._positionHint = function (xpos, ypos, ybot) {
      var hintWidth  = this.$hintContainer.width(),
          hintHeight = this.$hintContainer.height(),
          posOffset  = 4,
          top        = ypos - hintHeight - posOffset,
          left       = xpos;
      
      var $editorHolder = $("#editor-holder"),
          editorOffset  = $editorHolder.offset(),
          editorLeft;
      
      if(editorOffset === undefined){
         // this happens in jasmine tests that run without a windowed document.
         return;
      }

      editorLeft = editorOffset.left;
      left = Math.max(left, editorLeft);
      left = Math.min(left, editorLeft + $editorHolder.width() - hintWidth);

      if(top < 0){
         this.$hintContainer.removeClass("preview-bubble-above");
         this.$hintContainer.addClass("preview-bubble-below");
         this.$hintContainer.offset({
            left: left,
            top: ybot + posOffset
         });
      }else{
         this.$hintContainer.removeClass("preview-bubble-below");
         this.$hintContainer.addClass("preview-bubble-above");
         this.$hintContainer.offset({
            left: left,
            top: top - posOffset
         });
      }
   };
   
   ParameterHintManager.prototype._findParams = function(name, hintList){
      var hint = hintList.find(function(item){ return item.getName() === name; });
      return (typeof hint !== "undefined") ? hint.getDetails() : -1;
   };
   
   ParameterHintManager.prototype._registerCommands = function(){
      var menu = Menus.getMenu(Menus.AppMenuBar.EDIT_MENU),
          self = this;
      
      // register the command handler
      CommandManager.register(Strings.CMD_SHOW_PARAMETER_HINT, SASS_PARAM_CMD_ID, this._handleShowParameterHint);
      
      // Add the menu items
      if (menu) {
          menu.addMenuItem(SASS_PARAM_CMD_ID, KEY_BINDING, Menus.AFTER, Commands.SHOW_CODE_HINTS);
      }

      // Close the function hint when commands are executed, except for the commands
      // to show function hints for code hints.
      CommandManager.on("beforeExecuteCommand", function (event, commandId) {
         if (commandId !== SASS_PARAM_CMD_ID) {
            self.closeHint();
         }
      });
   };
   
   ParameterHintManager.prototype._handleShowParameterCmd = function(){
      var cursor   = this.editor.getCursorPos(),
          token    = this.editor._codeMirror.getRange({line: cursor.line, ch: 0}, cursor),
          startAt  = this._findBackParenthesis(token),
          startCur = {},
          source   = [];
      
      if(startAt === -1){
         return false;
      }
      
      startCur = {line: cursor.line, ch: startAt + 1};
      token    = token.substring(0, startAt+1);
      source   = this.dataHandler(token);
      
      if(!source){
         return false;
      }
      
      this.openHint(source.name, source.hintList, startCur, this._getToken(cursor, startCur));
   };
   
   /**
    *
    */
   ParameterHintManager.prototype._findBackParenthesis = function(source){
      var exp   = /[()]/,
          pos   = 0,
          count = 0,
          ch    = "";
      
      var maxScanLen = 300;
      
      if(source.length > maxScanLen){
         source = source.substr(source.length - maxScanLen);
      }
      
      pos = source.length-1;
      
      while(pos !== -1){
         ch = source.charAt(pos);
         
         if(exp.test(ch)){
            if(ch === ")") {
               ++count;
            } else if (--count === -1) {
               return pos;
            }
         }
         
         pos--;
      }
      
      return -1;
   };
   
   ParameterHintManager.prototype.overrideCommands = function(){
      if(!this.cmdReleased) return false;
      crrCmdHandler._commandFn = this._handleShowParameterCmd.bind(this);
      this.cmdReleased = false;
   };
   
   ParameterHintManager.prototype.releaseCommands = function(){
      if(this.cmdReleased) return false;
      crrCmdHandler._commandFn = crrCmdFunction;
      this.cmdReleased = true;
   };
   
   ParameterHintManager.prototype._inParams = function(cursor){
      if(cursor.line !== this.startCursor.line || cursor.ch < this.startCursor.ch ||
      (this.token.substr(-1, 1) === ")" && this._findBackParenthesis(this.token.slice(0,-1)) === -1)){
         return false;
      }
      
      return true;
   };
   
   ParameterHintManager.prototype._addListeners = function(){
      var cursorPos,
          self = this;
      
      this.editor.on("keydown.sassHints", function(e, editor, domEvent){
         if(domEvent.keyCode === KeyEvent.DOM_VK_ESCAPE){
            self.closeHint();
         }
      }).on("keypress.sassHints", function(e, editor, domEvent){
         if(domEvent.which === 44){
            self.showHint();
         }
      }).on("cursorActivity.sassHints", function(e){
         try{
            cursorPos  = e.target.getCursorPos();
            self.token = self._getToken(cursorPos);

            if(self._inParams(cursorPos)){
               if(self.visible){
                  self._popupHint();
               }
            } else {
               self.closeHint();
            }
         } catch(err){
            console.log(err);
            self.closeHint();
         }
      });
   };
   
   ParameterHintManager.prototype._getToken = function(endCur, startCur){
      startCur = startCur || this.startCursor;
      return this.editor._codeMirror.getRange(startCur, endCur);
   };
   
   ParameterHintManager.prototype._removeListeners = function(){
      this.editor.off("keydown.sassHints");
      this.editor.off("keypress.sassHints");
      this.editor.off("cursorActivity.sassHints");
   };
   
   ParameterHintManager.prototype._addToStack = function(){
      
   };
   
   module.exports = ParameterHintManager;
});