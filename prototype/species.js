// Geometry uses the same 800 × 620 scene coordinates as the shared SVG.
(function () {
  'use strict';
  const definitions = new Map();
  let current, installed;

  function get(id) {
    if (!definitions.has(id)) throw new Error('Unknown pet species: ' + id);
    return definitions.get(id);
  }

  window.SillySpecies = {
    register(id, definition) {
      if (definitions.has(id)) throw new Error('Duplicate pet species: ' + id);
      definitions.set(id, definition);
      current ??= definition;
    },
    get,
    get current() { return current; },
    select(id) {
      current = get(id);
      if (installed === current) return current;
      for (const layer of document.querySelectorAll('[data-species-face]')) {
        layer.style.display = layer.dataset.speciesFace === id ? '' : 'none';
      }
      const template = document.getElementById(current.scene.template);
      for (const slot of document.querySelectorAll('#scene [data-part]')) {
        const part = template.content.querySelector('[data-part~="' + slot.dataset.part + '"]');
        slot.replaceChildren(...(part ? part.cloneNode(true).childNodes : []));
      }
      for (const [selector, attrs] of current.scene.attributes(current.rig)) {
        for (const node of document.querySelectorAll(selector)) {
          for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
        }
      }
      installed = current;
      // 通知扩展模块（耳机 / 皇冠 / 后脚这些几何绑在物种上的装饰）重新适配
      window.dispatchEvent(new CustomEvent('silly:species', { detail: { id, species: current } }));
      return current;
    },
  };
})();
