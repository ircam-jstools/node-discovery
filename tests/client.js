import { DiscoveryClient } from '../src/index';
import { BROADCAST_PORT } from '../src/config';

const port = BROADCAST_PORT + 1;

console.log('client will be on port:', port);

const client = new DiscoveryClient({
  verbose: false,
  port: port,
  payload: { hostname: 'pouet-02.local' },
});

client.on('message', (rinfo, msg) => {
  // console.log(rinfo, msg.toString());
});

client.start();

// const exitHandler = () => client.stop();

// // do something when app is closing
// process.on('exit', exitHandler);
// // catches ctrl+c event
// process.on('SIGINT', exitHandler);
// // catches "kill pid" (for example: nodemon restart)
// process.on('SIGUSR1', exitHandler);
// process.on('SIGUSR2', exitHandler);
// // catches uncaught exceptions
// process.on('uncaughtException', exitHandler);
