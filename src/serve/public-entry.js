// @ts-check
/** @param {import('../types.js').Entry|null} entry @returns {import('../types.js').PublicEntry|null} */
export function publicEntry(entry) {
  if(entry?.kind!=='question')return entry;
  if(!entry.route.connector)return {...entry,route:entry.route};
  // This is a public capability view; the durable owner never becomes a hook waiter.
  return {...entry,route:{handback:true,waiter:null}};
}
/** @param {unknown} value @returns {unknown} */
export function publicView(value) {
  if(value===null||typeof value!=='object'||Array.isArray(value))return value;
  const v=/** @type {Record<string,any>} */ (value);
  return {...v,...(Object.hasOwn(v,'entry')?{entry:publicEntry(v.entry)}:{}),...(Array.isArray(v.entries)?{entries:v.entries.map(publicEntry)}:{})};
}
