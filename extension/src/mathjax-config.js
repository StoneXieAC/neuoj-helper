// Firefox 内容脚本的 globalThis 与 window 不同；MathJax 使用 window 保存实例。
window.MathJax = {
  loader: {
    paths: {
      mathjax: chrome.runtime.getURL('vendor/mathjax'),
      fonts: chrome.runtime.getURL('vendor')
    },
    require: file => import(file),
    load: ['ui/safe']
  },
  output: { fontPath: '[fonts]/%%FONT%%-font' },
  svg: { fontCache: 'local' },
  tex: { packages: { '[-]': ['require', 'autoload', 'noundefined'] }, maxMacros: 1000 },
  options: {
    enableMenu: false,
    enableSpeech: false,
    enableBraille: false,
    enableExplorer: false,
    menuOptions: {
      settings: { enrich: false, collapsible: false, speech: false, braille: false }
    },
    safeOptions: {
      allow: { URLs: 'none', classes: 'none', cssIDs: 'none', styles: 'none' }
    }
  },
  startup: { typeset: false }
};
