import type { HypotheticalLayer } from '@/model';

// Filled in once the baseline model's ids are final.
export const simpayLayer: HypotheticalLayer = {
  id: 'layer:simpay',
  name: 'SimPay — external payment service',
  description: 'A PayPal-like external wallet integrating with Meridian. Entirely hypothetical.',
  entities: [],
  relations: [],
  contracts: [],
  modifications: [],
  scenarios: [],
  builtIn: true,
};
