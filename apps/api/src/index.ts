import { makeApp } from './app.js';
import { config } from './config.js';

const port = Number(process.env.PORT ?? config.API_PORT);

makeApp().listen(port, '::', () => {
  console.log(`api listening on :::${port}`);
});
