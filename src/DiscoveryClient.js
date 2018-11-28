import dgram from 'dgram';
import { EventEmitter } from 'events';
import { BROADCAST_PORT } from './config';

const BROADCAST_ADDRESS = '255.255.255.255';

/**
 * Create a client that tries to connect to a DiscoveryServer.
 *
 * @example
 * import { DiscoveryClient } from '@ircam/node-discovery';
 *
 * const client = new DiscoveryClient({
 *   port: BROADCAST_PORT + Math.floor(Math.random() * 1000),
 *   broadcastPort: BROADCAST_PORT,
 *   verbose: true,
 * });
 * client.on('connection', rinfo => console.log('connection', rinfo));
 * client.on('close', () => console.log('close'));
 */
class DiscoveryClient extends EventEmitter {
  constructor({
    port = BROADCAST_PORT,
    broadcastPort = BROADCAST_PORT,
    broadcastAddress = BROADCAST_ADDRESS,
    discoverInterval = 2000, // ms
    keepaliveInterval = 1000, // ms
    retryTimeout = 1000, // ms, try request again after duration
    disconnectTimeout = 10000, // ms, reset connection after duration
    payload = {},
    verbose = false,
  } = {}) {
    super();

    this.port = port;
    this.broadcastPort = broadcastPort;
    this.broadcastAddress = broadcastAddress;
    this.payload = payload;
    this.verbose = verbose;

    this.udp = null;

    this.state = 'disconnected';
    this.server = null;

    this.broadcast = this.broadcast.bind(this);
    this.messageId = -1; // ID of _last_ message
    this.send = this.send.bind(this);

    this.retryTimeout = retryTimeout;
    this.retryTimeoutId = null;

    this.disconnectTimeout = disconnectTimeout;
    this.disconnectTimeoutId = null;

    this.discoverInterval = discoverInterval;
    this.discoverTimeoutId = null; // periodic
    this._sendDiscoverReq = this._sendDiscoverReq.bind(this);
    this._receiveDiscoverAck = this._receiveDiscoverAck.bind(this);

    this._sendConnectReq = this._sendConnectReq.bind(this);
    this._receiveConnectAck = this._receiveConnectAck.bind(this);

    this.keepaliveInterval = keepaliveInterval;
    this.keepaliveTimeoutId = null; // periodic
    this._sendKeepaliveReq = this._sendKeepaliveReq.bind(this);
    this._receiveKeepaliveAck = this._receiveKeepaliveAck.bind(this);

    this._resetConnection = this._resetConnection.bind(this);

    this._receiveError = this._receiveError.bind(this);
  }

  /**
   * Start the client.
   */
  start() {
    this._setupSocket();
  }

  /**
   * Stop the client.
   */
  stop() {
    this.udp.close();
  }

  /**
   * Send a message to the server.
   *
   * @param {String} msg - Message to send.
   */
  send(msg) {
    if (this.udp) {
      const buf = Buffer.from(msg);
      const { port, address } = this.server;

      this.udp.setBroadcast(false);
      this.udp.send(buf, 0, buf.length, port, address);

      if(this.verbose) {
        console.log('send: ', msg);
      }
    }
  }

  broadcast(msg) {
    if (this.udp) {
      const buf = Buffer.from(msg);
      const port =  this.broadcastPort;
      const address = this.broadcastAddress;

      this.udp.setBroadcast(true);
      this.udp.send(buf, 0, buf.length, port, address);

      if(this.verbose) {
        console.log('broadcast: ', msg);
      }
    }
  }

  _setupSocket() {
    this.udp = dgram.createSocket('udp4');

    this.udp.on('message', (buffer, rinfo) => {
      const msg = buffer.toString().split(' ');

      if(this.verbose) {
        console.log('receive: ', msg);
      }

      switch(msg[0]) {
        case 'DISCOVER_ACK': {
          this._receiveDiscoverAck(msg, rinfo);
          break;
        }
        case 'CONNECT_ACK': {
          this._receiveConnectAck(msg, rinfo);
          break;
        }
        case 'KEEPALIVE_ACK': {
          this._receiveKeepaliveAck(msg, rinfo);
          break;
        }
        case 'ERROR': {
          this._receiveError(msg, rinfo);
          break;
        }
        default: {
          // forward messages that are not part of the connection protocol
          this.emit('message', buffer, rinfo);
          break;
        }

      }
    });

    this.udp.on('listening', this._sendDiscoverReq);

    this.udp.bind(this.port, () => {
      if (this.verbose)
        console.log('binded to port:', this.port);
    });
  }

  _sendDiscoverReq() {
    clearTimeout(this.discoverTimeoutId);
    this.messageId += 1;
    const msg = 'DISCOVER_REQ ' + this.messageId;
    this.broadcast(msg);

    // send handshakes until we have a response from the server
    this.discoverTimeoutId = setTimeout(this._sendDiscoverReq, this.discoverInterval);
  }

  _receiveDiscoverAck(msg, rinfo) {
    const messageId = parseInt(msg[1]);
    if(this.messageId !== messageId) {
      if(this.verbose) {
        console.log('ignore discover ack ' + msg[1]);
      }
    } else {
      clearTimeout(this.discoverTimeoutId);

      this.server = rinfo;
      if(this.verbose) {
        console.log('> discover: ', this.server);
      }

      if(this.state !== 'connected') {
        this._sendConnectReq();
      }
    }
  }

  _sendConnectReq() {
    clearTimeout(this.retryTimeoutId);
    this.messageId += 1;
    const msg = 'CONNECT_REQ ' + this.messageId + ' ' + JSON.stringify(this.payload);
    this.send(msg);

    this.retryTimeoutId = setTimeout(this._sendConnectReq, this.retryTimeout);
  }

  _receiveConnectAck(msg, rinfo) {
    const messageId = parseInt(msg[1]);
    if(this.messageId !== messageId) {
      if(this.verbose) {
        console.log('ignore connect ack ' + msg[1]);
      }
    } else {
      clearTimeout(this.retryTimeoutId);

      this.state = 'connected';
      this.emit('connection', rinfo);
      this._sendKeepaliveReq();
    }
  }

  _sendKeepaliveReq() {
    clearTimeout(this.retryTimeoutId);
    clearTimeout(this.keepaliveTimeoutId);

    this.messageId += 1;
    const msg = 'KEEPALIVE_REQ ' + this.messageId + ' ' + JSON.stringify(this.payload);
    this.send(msg);

    this.retryTimeoutId = setTimeout(this._sendKeepaliveReq, this.retryTimeout);
    if(!this.disconnectTimeoutId) {
      this.disconnectTimeoutId = setTimeout(this._resetConnection, this.disconnectTimeout);
    }
  }

  _receiveKeepaliveAck(msg, rinfo) {
    const messageId = parseInt(msg[1]);

    if (this.messageId !== messageId) {
      if (this.verbose) {
        console.log('ignore keepalive ack ' + msg[1]);
      }
    } else {
      clearTimeout(this.retryTimeoutId);
      clearTimeout(this.keepaliveTimeoutId);
      clearTimeout(this.disconnectTimeoutId);
      this.disconnectTimeoutId = null;

      this.keepaliveTimeoutId = setTimeout(this._sendKeepaliveReq, this.keepaliveInterval);
    }
  }

  _receiveError(msg, rinfo) {
    const messageId = parseInt(msg[1]);
    if (this.messageId !== messageId) {
      if (this.verbose) {
        console.log('ignore error ' + msg[1]);
      }
    } else {
      this._resetConnection();
      if(this.verbose) {
        console.log('> error: ' + msg);
      }
    }
  }

  _resetConnection() {
    this.messageId += 1; // discard any previous message

    clearTimeout(this.retryTimeoutId);
    clearTimeout(this.disconnectTimeoutId);
    clearTimeout(this.discoverTimeoutId);
    clearTimeout(this.keepaliveTimeoutId);

    if (this.state === 'connected') {
      this.emit('close');
    }

    this.state = 'disconnected';
    this.server = null;

    this._sendDiscoverReq();
  }
}

export default DiscoveryClient;
