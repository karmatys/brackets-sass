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
   
   /**
    * Prepares object to work. This will be called only once, when instance will be created
   */
   ParameterHintManager.prototype._init = function(){
      // prepare DOM handlers
      this.$hintContainer = $("body").find("#function-hint-container");
      
      if(this.$hintContainer.length < 0){
         this.$hintContainer = $(hintBody).appendTo($("body"));
      }
      
      this.$hintContent = this.$hintContainer.children().first();
      
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
    * Refreshes instance whenever editor will be changed.
   */
   ParameterHintManager.prototype.init = function(editor){
      // set editor for events later
      this.editor  = editor;
   };
   
   /**
    * Determines, if session hint is active or not
    *
    * @return {boolean} true, if parameters hint is active
   */
   ParameterHintManager.prototype.isActive = function(){
      return this.active;
   };
   
   /**
    * Determines, if hint container is visible or not
    *
    * @return {boolean} true, if parameters hint is visible
   */
   ParameterHintManager.prototype.isVisible = function(){
      return this.visible;
   };
   
   /**
    * Determines, if command (associated with the same keys) was detected and overridden.
    * It's possible to restore previous command function by #releaseCommands method
    *
    * @return {boolean} true, if command was overridden
   */
   ParameterHintManager.prototype.isCmdOverridden = function(){
      return typeof crrCmd !== "undefined";
   };
   
   /**
    * Defines function which provides data (HintItem array) when parameter hints will be request by command
    *
    * @param {function} fn - function which returns data for hint request
   */
   ParameterHintManager.prototype.setDataForHintRequest = function(fn){
      this.dataHandler = fn;
   };
   
   /**
    * It create new hinting session and display content in code editor. It can be called in the same session
    * what causes storing previous hint data in stack and temporary change content to new hint
    *
    * @param {string} hintName - function or mixin name
    * @param {Array<HintItem>|string} hintParams - raw hint parameters or list which will be searched
    * @param {Object} cursor - current cursor position
    * @param {string} token - optional. fragment which help to indicate current position in hint content
    *
    * @return {boolean} true, if success
   */
   ParameterHintManager.prototype.openHint = function(hintName, hintParams, cursor, token){
      // params are not given, we have to find them in array by hint name
      if(Array.isArray(hintParams)){
         hintParams = this._findParams(hintName, hintParams);
         
         // definition not found
         if(hintParams === -1){
            return false;
         }   
      }
      
      if(this.active){
         // parameters hint is already open, store current state
         this._storeHintState();
      } else{
         // add listeners
         this._addListeners();
      }
      
      var hintPos = this.editor._codeMirror.charCoords({line: cursor.line, ch: cursor.ch - 1});
      
      // store hint details
      this.startCursor = cursor;
      this.hintName    = hintName;
      this.hintParams  = (hintParams === "()") ? Strings.NO_ARGUMENTS : hintParams.slice(1, -1).split(",");
      this.token       = token || "";
      
      // show hints
      this._popupHint();
      
      // set position
      this._positionHint(hintPos.left, hintPos.top, hintPos.bottom);
      
      return true;
   };
   
   /**
    * Dismiss parameters hint from code editor and destroy session
    *
    * @return {boolean} true, if success
   */
   ParameterHintManager.prototype.closeHint = function(){
      if(!this.active) return true;
                            
      this.$hintContainer.hide();
      this.$hintContent.empty();
      this._removeListeners();
      
      this.hintStack = [];
      this.active = this.visible = false;
      
      return true;
   };
   
   /**
    * Show hint container in code editor, if session is active
    *
    * @return {boolean} true, if success
   */
   ParameterHintManager.prototype.showHint = function(){
      if(!this.active && this.visible) return false;
      
      this.$hintContainer.show();
      return this.visible = true;
   };
   
   /**
    * Hide hint container in code editor, but not destroy current session
    *
    * @return {boolean} true, if success
   */
   ParameterHintManager.prototype.hideHint = function(){
      if(!this.active && !this.visible) return false;
      
      this.$hintContainer.hide();
      this.visible = false;
      return true;
   };
   
   /**
    * Prepare hint params to display in editor
    *
    * @param {Array<string>|string} source - separated parameters or string with "no params" notice
    *
    * @return {string} escaped and formated HTML string
   */
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
   
   /**
    * Update hint content and show
   */
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
     * Set position for hint container.
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
   
   /**
    * Find parameters from given hint list
    *
    * @param {string} name - hint name
    * @param {Array<HintList>} hintList - source array
    *
    * @return {string|number} parameters or -1, if hint cannot be found
   */
   ParameterHintManager.prototype._findParams = function(name, hintList){
      var hint = hintList.find(function(item){ return item.getName() === name; });
      return (typeof hint !== "undefined") ? hint.getDetails() : -1;
   };
   
   /**
    * Register commands in brackets and create menu item
   */
   ParameterHintManager.prototype._registerCommands = function(){
      var menu = Menus.getMenu(Menus.AppMenuBar.EDIT_MENU),
          self = this;
      
      // register the command handler
      CommandManager.register(Strings.CMD_SHOW_PARAMETER_HINT, SASS_PARAM_CMD_ID, this._handleShowParameterCmd.bind(this));
      
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
   
   /**
    * Handles hint request called by command manager. If cursor is inside function (or mixin) parentheses
    * this open new hint session
   */
   ParameterHintManager.prototype._handleShowParameterCmd = function(){
      // if hint session is active, show hint
      if(this.active){
         this.showHint();
         return;
      }
      
      var cursor   = this.editor.getCursorPos(),
          token    = this.editor._codeMirror.getRange({line: cursor.line, ch: 0}, cursor),
          startAt  = this._findBackParenthesis(token),
          startCur = {},
          source   = [];
      
      if(startAt === -1){
         return;
      }
      
      startCur = {line: cursor.line, ch: startAt + 1};
      token    = token.substring(0, startAt+1);
      source   = this.dataHandler(token);
      
      if(!source){
         return;
      }
      
      this.openHint(source.name, source.hintList, startCur, this._getToken(cursor, startCur));
   };
   
   /**
    * Store current hint data in stack
   */
   ParameterHintManager.prototype._storeHintState = function(){
      this.hintStack.push({
         name: this.hintName,
         params: this.hintParams,
         startCur: this.startCursor,
         token: this.token,
         offset: {top: parseFloat(this.$hintContainer[0].style.top), left: parseFloat(this.$hintContainer[0].style.left)}
      });
   };
   
   /**
    * Restores data to current hint session
    *
    * @param {Object} state - hint data
    *
    * @return {boolean} true, if success
   */
   ParameterHintManager.prototype._restoreHintState = function(state){
      this.startCursor = state.startCur;
      this.hintName    = state.name;
      this.hintParams  = state.params;
      this.token       = state.token;
      
      // back position
      this.$hintContainer.offset(state.offset);
      
      return true;
   };
   
   /**
    * Find first open parenthesis position from the end of string
    *
    * @param {string} source - input text
    *
    * @return {number} position number or -1, if parenthesis not found
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
   
   /**
    * Override current command handler by own function
   */
   ParameterHintManager.prototype.overrideCommands = function(){
      if(!this.cmdReleased) return false;
      crrCmdHandler._commandFn = this._handleShowParameterCmd.bind(this);
      this.cmdReleased = false;
   };
   
   /**
    * Restore previous function which handles command
   */
   ParameterHintManager.prototype.releaseCommands = function(){
      if(this.cmdReleased) return false;
      crrCmdHandler._commandFn = crrCmdFunction;
      this.cmdReleased = true;
   };
   
   /**
    * Determines whether cursor is inside a function parentheses
    *
    * @param {Object} cursor - current cursor
    *
    * @return {boolean} false, if cursor is out of range
   */
   ParameterHintManager.prototype._inParams = function(cursor){
      // check cursor coordinates
      if(cursor.line !== this.startCursor.line || cursor.ch < this.startCursor.ch) return false;
      
      // check, if cursor is behind a function call
      if(this.token.substr(-1, 1) === ")" && this._findBackParenthesis(this.token.slice(0,-1)) === -1){
         // is something stored in stack?
         if(this.hintStack.length > 0){
            return this._restoreHintState(this.hintStack.pop());
         }
         
         return false;
      }
      
      return true;
   };
   
   /**
    * Add listeners which track user input and session
   */
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
   
   /**
    * Get token from specified range
    *
    * @param {Object} endCur - current cursor position (end of range)
    * @param {Object} startCur - optional. If this parameter is omitted, cached cursor will be used
    *
    * @return {string}  fragment text from editor
    */
   ParameterHintManager.prototype._getToken = function(endCur, startCur){
      startCur = startCur || this.startCursor;
      return this.editor._codeMirror.getRange(startCur, endCur);
   };
   
   /**
    * Remove listeners which track user input and session
   */
   ParameterHintManager.prototype._removeListeners = function(){
      this.editor.off("keydown.sassHints");
      this.editor.off("keypress.sassHints");
      this.editor.off("cursorActivity.sassHints");
   };
   
   module.exports = ParameterHintManager;
});