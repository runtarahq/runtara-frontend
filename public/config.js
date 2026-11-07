// The deployment's runtime settings (window.__RUNTARA_CONFIG__). This copy
// sets none: the console image overwrites it at startup from RUNTARA_UI_* env
// vars (docker/render-config.sh), and a static host without it falls back to
// config.json (src/shared/config/staticConfig.ts) or the build-time VITE_*
// values.
window.__RUNTARA_CONFIG__ = {};
