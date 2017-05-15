# Sass code hints for Brackets
An extension for [Brackets](https://github.com/adobe/brackets/) to show SASS hints in the code editor.

### How to Install
1. Select **Brackets > File > Extension Manager...**
2. Search for this extension.
3. Click on the **Install** button.

### How to Use Extension
Currently only SCSS file format is supported.

### Extension Preferences

**`codehint.SassHint`** *(boolean)*<br/>
If the value of this preference is `true`, sass hints will be enabled.
Otherwise, the extenion will be disabled.

**`sasscodehints.maxHints`** *(number)*<br/>
This value determines maximum length of hint list.

**`sasscodehints.showBuiltFns`** *(boolean)*<br/>
This value define, whether built-in functions will be shown in hint list or not.

**`sasscodehints.commonLibs`** *(string)*<br/>
Absolute path to the common "partial" files.<br/>
When we import files by *@import 'file'* the extension firstly looking for a file in directory relative to edited file. If they not exists, script will continue searching in directory, which was passed by *commonLibs* preference.

For more information on setting preferences see [How to Use Brackets - Preferences](https://github.com/adobe/brackets/wiki/How-to-Use-Brackets#preferences)

### Planned development

1. Functions / Mixins paramenter hints
2. Local variables and argument hints within function / mixin body

### License
MIT-licensed -- see `main.js` for details.

### Compatibility
Tested on Brackets Release 1.7 (Windows 7).