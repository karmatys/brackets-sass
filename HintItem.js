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

/*jshint plusplus: true, devel: true, nomen: true, indent: 3, maxerr: 50, regexp: true, strict: true */
/*global define, brackets, $ */

define(function (require, exports, module) {
   "use strict";
   
   var ColorUtils = brackets.getModule("utils/ColorUtils"),
       colorRegExp = /(?:#[a-f0-9]{3,6}|(?:rgb|hsl)a?\((?:[0-9\.\s]+\,){2,3}[0-9\.\s]+?\))/i;
   
   function HintItem(name, details, type, source){
      // name of varable, mixin, function ect.
      this.name = name;
      
      // more details about hint e.g. variable value or mixin/function params
      this.details = details || "";
      this.source  = source  || "";
      this.type    = type    || "V";
      
      this.color = this.isColor();
      
      this.matchGoodness = 0;
      this.stringRanges  = null;
   }
   
   HintItem.prototype.getName = function(){
      return this.name;
   };
   
   HintItem.prototype.getDetails = function(){
      return this.value;
   };
   
   HintItem.prototype.setDetails = function(value){
      this.details = value || "";
      this.color = this.isColor();
   };
   
   HintItem.prototype.setSource = function(src){
      this.source = src;
   };
   
   HintItem.prototype.getType = function(){
      return this.type;
   };
   
   HintItem.prototype.setParams = function(text){
      this.details = "(" + text.trim() + ")";
   };
   
   HintItem.prototype.isColor = function(){
      return colorRegExp.test(this.details) || ColorUtils.COLOR_NAMES.indexOf(this.details) !== -1;
   };
      
   HintItem.prototype.toHTML = function(){
      var $hintObj = $("<span>").addClass("brackets-sass-hints");
      
      // print color or type of hint
      if(this.color){
         ColorUtils.formatColorHint($hintObj, this.details);
      } else {
         $hintObj.append($("<span>").text(this.type).addClass("brackets-sass-hints-type"));
      }
      
      // highlight the matched portion of each hint
      if (this.stringRanges) {
         this.stringRanges.forEach(function (item) {
            if (item.matched) {
               $hintObj.append($("<span>").text(item.text).addClass("matched-hint"));
            } else {
               $hintObj.append(item.text);
            }
         });
      } else {
         $hintObj.text(this.name);
      }
      
      // show preview of item value
      if(this.details){
         $hintObj.append($("<span>").text(this.details).addClass("brackets-sass-hints-details"));
      }
      
      // add source to hint
      if(this.source !== ""){
         $hintObj.append($("<span>").text(this.source).addClass("brackets-sass-hints-source"));
      }
      
      // add name to jquery item and return
      $hintObj.data("token", this.name);
      return $hintObj;
   };
   
   module.exports = HintItem;
});