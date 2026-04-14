import Conf from 'conf';

const schema = {
  port: {
    type: 'number',
    default: 8787,
  },
  devices: {
    type: 'array',
    default: [],
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        token: { type: 'string' },
        pairedAt: { type: 'string' },
      },
    },
  },
};

const config = new Conf({ projectName: 'termserver', schema });

export function getConfig() {
  return config;
}

export function addDevice(device) {
  const devices = config.get('devices');
  devices.push(device);
  config.set('devices', devices);
}

export function removeDevice(id) {
  const devices = config.get('devices').filter((d) => d.id !== id);
  config.set('devices', devices);
}

export function getDevices() {
  return config.get('devices');
}

export function getPort() {
  return config.get('port');
}

export function setPort(port) {
  config.set('port', port);
}
