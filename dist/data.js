'use strict';
window.EmberLoadJSON = async function(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Archive request failed: ' + response.status);
  if (!('DecompressionStream' in window)) throw new Error('This browser needs gzip support. Use a current version of Chrome, Safari, Edge or Firefox.');
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
};
document.querySelectorAll('main button, main input, main select').forEach(element=>{element.dataset.initialDisabled=String(element.disabled);element.disabled=true;});
window.EMBER_READY = window.EmberLoadJSON('observations.json.gz');
