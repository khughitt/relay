// Private native qualification cases and evidence judgment; never runtime policy.
export const pilotCases=['deny','prefix-allow','prefix-prompt','sandbox','environment-worker'].flatMap(gate=>
  ['personal','work'].map(policy=>({id:`${policy}-${gate}`,policy,gate:gate==='deny'?'deny':gate==='environment-worker'?'environment':'policy',scenario:gate})));

export function judgeCase(def,{original,rewritten}) {
  for(const o of [original,rewritten]){
    if(!o||o.mode!=='interactive-tui'||!o.complete||!o.hookSeen||o.cleanup?.survivors?.length!==0)return {status:'incomplete',reason:'missing-required-tui-evidence'};
  }
  if(def.gate==='deny'){
    if(original.sentinel||rewritten.sentinel)return {status:'failed',reason:'denied-command-ran'};
    if(!original.denialSeen||!rewritten.denialSeen)return {status:'incomplete',reason:'deny-not-observed'};
  }else if(def.gate==='policy'){
    if(original.decision==='unknown'||rewritten.decision==='unknown')return {status:'incomplete',reason:'policy-observation-missing'};
    for(const k of ['decision','prompts','sentinel','boundary']){
      if(original[k]===undefined||rewritten[k]===undefined)return {status:'incomplete',reason:'policy-observation-missing'};
      if(original[k]!==rewritten[k])return {status:'failed',reason:`policy-changed-${k}`};
    }
  }else return {status:'incomplete',reason:'worker-fork-model-evidence-pending'};
  return {status:'passed'};
}
