/**
 * Copyright (c) 2014-2024 The xterm.js authors. All rights reserved.
 * @license MIT
 *
 * Copyright (c) 2012-2013, Christopher Jeffrey (MIT License)
 * @license MIT
 *
 * Originally forked from (with the author's permission):
 *   Fabrice Bellard's javascript vt100 for jslinux:
 *   http://bellard.org/jslinux/
 *   Copyright (c) 2011 Fabrice Bellard
 */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var h=2,_=1,o=class{activate(e){this._terminal=e}dispose(){}fit(){let e=this.proposeDimensions();if(!e||!this._terminal||isNaN(e.cols)||isNaN(e.rows))return;let t=this._terminal._core;(this._terminal.rows!==e.rows||this._terminal.cols!==e.cols)&&(t._renderService.clear(),this._terminal.resize(e.cols,e.rows))}proposeDimensions(){if(!this._terminal||!this._terminal.element||!this._terminal.element.parentElement)return;let t=this._terminal._core._renderService.dimensions;if(t.css.cell.width===0||t.css.cell.height===0)return;let s=this._terminal.options.scrollback===0?0:this._terminal.options.overviewRuler?.width||14,r=this._terminal.element.parentElement,l=window.getComputedStyle(r),a={top:parseInt(l.getPropertyValue("padding-top")),bottom:parseInt(l.getPropertyValue("padding-bottom")),right:parseInt(l.getPropertyValue("padding-right")),left:parseInt(l.getPropertyValue("padding-left"))},i=Math.max(0,r.clientHeight-(a.top+a.bottom)),n=Math.max(0,r.clientWidth-(a.left+a.right)),m=window.getComputedStyle(this._terminal.element),d={top:parseInt(m.getPropertyValue("padding-top")),bottom:parseInt(m.getPropertyValue("padding-bottom")),right:parseInt(m.getPropertyValue("padding-right")),left:parseInt(m.getPropertyValue("padding-left"))},c=d.top+d.bottom,p=d.right+d.left,f=i-c,g=n-p-s,u=Math.max(1,Math.ceil(t.css.cell.height));return{cols:Math.max(h,Math.floor(g/t.css.cell.width)),rows:Math.max(_,Math.floor(f/u))}}};export{o as FitAddon};
//# sourceMappingURL=addon-fit.mjs.map
