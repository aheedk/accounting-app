import { makeApp } from './app.js';
import { config } from './config.js';

makeApp().listen(config.API_PORT, '::', () => {
  console.log(`api listening on :::${config.API_PORT}`);
});
