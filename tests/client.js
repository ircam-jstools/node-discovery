import { DiscoveryClient } from '../src/index';
import { BROADCAST_PORT } from '../src/config';

const port = BROADCAST_PORT + Math.floor(Math.random() * 1000);

console.log('client will be on port:', port);

const client = new DiscoveryClient({
  verbose: true,
  port: port,
  payload: { hostname: 'pouet-02.local' },
});

client.on('message', (rinfo, msg) => {
  console.log(rinfo, msg.toString());
});
