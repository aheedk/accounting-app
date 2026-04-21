import { makeApp } from './app.js';
import { config } from './config.js';

makeApp().listen(config.API_PORT, '0.0.0.0', () => {
  console.log(`api listening on 0.0.0.0:${config.API_PORT}`);
});
