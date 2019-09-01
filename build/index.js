!function(t,e){"object"==typeof exports&&"object"==typeof module?module.exports=e():"function"==typeof define&&define.amd?define("websocket-express",[],e):"object"==typeof exports?exports["websocket-express"]=e():t["websocket-express"]=e()}(global,function(){return function(t){var e={};function n(r){if(e[r])return e[r].exports;var o=e[r]={i:r,l:!1,exports:{}};return t[r].call(o.exports,o,o.exports,n),o.l=!0,o.exports}return n.m=t,n.c=e,n.d=function(t,e,r){n.o(t,e)||Object.defineProperty(t,e,{enumerable:!0,get:r})},n.r=function(t){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(t,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(t,"__esModule",{value:!0})},n.t=function(t,e){if(1&e&&(t=n(t)),8&e)return t;if(4&e&&"object"==typeof t&&t&&t.__esModule)return t;var r=Object.create(null);if(n.r(r),Object.defineProperty(r,"default",{enumerable:!0,value:t}),2&e&&"string"!=typeof t)for(var o in t)n.d(r,o,function(e){return t[e]}.bind(null,o));return r},n.n=function(t){var e=t&&t.__esModule?function(){return t.default}:function(){return t};return n.d(e,"a",e),e},n.o=function(t,e){return Object.prototype.hasOwnProperty.call(t,e)},n.p="",n(n.s=1)}([function(t,e){t.exports=require("url")},function(t,e,n){t.exports=n(3)},function(t,e){t.exports=require("mongodb")},function(t,e,n){"use strict";n.r(e);var r=n(0);function o(t){return t?new Promise(e=>setTimeout(e,t)):null}class i{constructor(t={},e=0){this.data=new Map,this.keys=new Map,this.simulatedLatency=e,Object.keys(t).forEach(e=>{this.keys.set(e,{map:new Map,options:t[e]})})}internalGetIds(t,e){if("id"===t)return this.data.has(e)?[e]:[];const n=this.keys.get(t);if(!n)throw new Error(`Requested key ${t} not indexed`);const r=n.map.get(e);return r?[...r]:[]}internalCheckDuplicates(t,e){if(e&&this.data.has(t.id))throw new Error("duplicate");this.keys.forEach(({map:e,options:n},r)=>{if(n.unique&&e.has(t[r]))throw new Error("duplicate")})}internalPopulateIndices(t){this.keys.forEach(({map:e},n)=>{const r=t[n];let o=e.get(r);o||(o=new Set,e.set(r,o)),o.add(t.id)})}internalRemoveIndices(t){this.keys.forEach(({map:e},n)=>{const r=t[n],o=e.get(r);o.delete(t.id),o.length||e.delete(r)})}async add(t){await o(this.simulatedLatency),this.internalCheckDuplicates(t,!0),this.data.set(t.id,JSON.stringify(t)),this.internalPopulateIndices(t)}async update(t,e,n,{upsert:r=!1}={}){await o(this.simulatedLatency);const i=this.internalGetIds(t,e)[0];if(void 0===i)return void(r&&await this.add(Object.assign({[t]:e},n)));const a=JSON.parse(this.data.get(i)),s=Object.assign({},a,n);if(s.id!==a.id)throw new Error("Cannot update id");this.internalRemoveIndices(a);try{this.internalCheckDuplicates(n,!1)}catch(t){throw this.internalPopulateIndices(a),t}this.data.set(s.id,JSON.stringify(s)),this.internalPopulateIndices(s)}async get(t,e,n=null){const r=await this.getAll(t,e,n);return r.length?r[0]:null}async getAll(t,e,n=null){let r;return await o(this.simulatedLatency),(r=t?this.internalGetIds(t,e):[...this.data.keys()]).map(t=>(function(t,e){if(!e)return t;const n={};return e.forEach(e=>{n[e]=t[e]}),n})(JSON.parse(this.data.get(t)),n))}}global.collectionStorageInMemory||(global.collectionStorageInMemory=new Map);const a=global.collectionStorageInMemory;class s{constructor({simulatedLatency:t=0}={}){this.simulatedLatency=t,this.mapTables=new Map}static connect(t){const e=new r.URL(t),n=e.hostname;if(n&&a.has(n))return a.get(n);const o=e.searchParams,i=Number(o.get("simulatedLatency")),c=new s({simulatedLatency:i});return n&&a.set(n,c),c}getCollection(t,e){return this.mapTables.has(t)||this.mapTables.set(t,new i(e,this.simulatedLatency)),this.mapTables.get(t)}}function c(t,e){var n=Object.keys(t);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(t);e&&(r=r.filter(function(e){return Object.getOwnPropertyDescriptor(t,e).enumerable})),n.push.apply(n,r)}return n}function u(t){for(var e=1;e<arguments.length;e++){var n=null!=arguments[e]?arguments[e]:{};e%2?c(n,!0).forEach(function(e){l(t,e,n[e])}):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(n)):c(n).forEach(function(e){Object.defineProperty(t,e,Object.getOwnPropertyDescriptor(n,e))})}return t}function l(t,e,n){return e in t?Object.defineProperty(t,e,{value:n,enumerable:!0,configurable:!0,writable:!0}):t[e]=n,t}function d(t,e){if(null==t)return{};var n,r,o=function(t,e){if(null==t)return{};var n,r,o={},i=Object.keys(t);for(r=0;r<i.length;r++)n=i[r],e.indexOf(n)>=0||(o[n]=t[n]);return o}(t,e);if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(t);for(r=0;r<i.length;r++)n=i[r],e.indexOf(n)>=0||Object.prototype.propertyIsEnumerable.call(t,n)&&(o[n]=t[n])}return o}function f(t){var e=function(t,e){if("object"!=typeof t||null===t)return t;var n=t[Symbol.toPrimitive];if(void 0!==n){var r=n.call(t,e||"default");if("object"!=typeof r)return r;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===e?String:Number)(t)}(t,"string");return"symbol"==typeof e?e:String(e)}const p="_id",h="id";function y(t){return t===h?p:t}function b(t){if(!t||void 0===t[h])return t;const{[h]:e}=t,n=d(t,[h].map(f));return u({[p]:e},n)}function m(t){if(!t||void 0===t[p])return t;const{[p]:e}=t,n=d(t,[p].map(f));return u({[h]:e},n)}function g(t){const e={};return t&&(e[p]=!1,t.forEach(t=>{e[y(t)]=!0})),e}class w{constructor(t,e={}){this.collection=t,Object.keys(e).forEach(n=>{e[n].unique?t.createIndex({[n]:1},{unique:!0}):t.createIndex({[n]:"hashed"})})}async add(t){await this.collection.insertOne(b(t))}async update(t,e,n,{upsert:r=!1}={}){await this.collection.updateOne({[y(t)]:e},{$set:b(n)},{upsert:r})}async get(t,e,n=null){return m(await this.collection.findOne({[y(t)]:e},{projection:g(n)}))}async getAll(t,e,n=null){const r=[];let o;const i=g(n);return o=t?await this.collection.find({[y(t)]:e},{projection:i}):await this.collection.find({},{projection:i}),await o.forEach(t=>r.push(m(t))),r}}class O{constructor(t){this.db=t}static async connect(t){const{MongoClient:e}=await Promise.resolve().then(()=>n(2)),r=await e.connect(t,{useNewUrlParser:!0,useUnifiedTopology:!0});return new O(r.db())}getCollection(t,e){const n=this.db.collection(t);return new w(n,e)}}n.d(e,"MemoryDb",function(){return s}),n.d(e,"MongoDb",function(){return O});e.default=class{static async connect(t){let e;if(t.startsWith("memory"))e=s;else{if(!t.startsWith("mongodb"))throw new Error(`Unsupported database connection string: ${t}`);e=O}try{return await e.connect(t)}catch(e){throw new Error(`Failed to connect to database "${t}": ${e.message}`)}}}}])});
//# sourceMappingURL=index.js.map