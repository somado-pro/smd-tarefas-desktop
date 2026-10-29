import{hB as n,gP as c}from"./index-lzAVsDmF.js";/**
 * @license lucide-react v1.16.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u=[["path",{d:"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",key:"1m0v6g"}],["path",{d:"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",key:"ohrbg2"}]],d=n("square-pen",u);function i(e){const[r,l]=c.useState(null);return c.useEffect(()=>{let o=!1,t=null;return fetch(e).then(a=>a.ok?a.blob():Promise.reject(new Error(`Erro ${a.status}`))).then(a=>{t=URL.createObjectURL(a),o?URL.revokeObjectURL(t):l({de:e,url:t})}).catch(()=>{o||l({de:e,url:"data:,"})}),()=>{o=!0,t&&URL.revokeObjectURL(t)}},[e]),r?.de===e?r.url:void 0}export{d as S,i as u};
