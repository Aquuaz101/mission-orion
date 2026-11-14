import type { MissionEntry } from '../shared/protocol';

/**
 * Mission catalogue. To add a mission (e.g. ISS later): create its module under
 * src/missions/<id>/, register a loader in App, and flip `enabled` here.
 */
export interface MissionInfo extends MissionEntry {
  subtitle: string;
  verb: 'OBSERVE' | 'EXPLORE' | 'MAINTAIN';
  instrument: string;
  description: string;
  duration: string;
  image: string;
  imagePos: string;
  imageSize?: string;
  imageFilter?: string;
}

export const MISSIONS: MissionInfo[] = [
  {
    id: 'jupiter',
    code: '01',
    title: 'Jupiter',
    subtitle: 'Deep Space Observatory',
    verb: 'OBSERVE',
    instrument: 'Hubble Space Telescope · WFC3',
    description: 'Point, zoom and focus Hubble to capture Jupiter, its Great Red Spot and the icy moon Europa.',
    duration: '≈ 2 min',
    enabled: true,
    image: '/textures/jupiter.jpg',
    imagePos: '36.4% 61%',
    imageSize: 'auto 290%',
  },
  {
    id: 'mars',
    code: '02',
    title: 'Mars',
    subtitle: 'Red Planet Expedition',
    verb: 'EXPLORE',
    instrument: 'Perseverance-class rover · Jezero Crater',
    description: 'Drive real Jezero terrain, collect geological samples and respond to an emergency in a dust storm.',
    duration: '≈ 3 min',
    enabled: true,
    image: '/data/jezero_ortho.jpg',
    imagePos: '60% 30%',
    imageFilter: 'sepia(1) saturate(2.2) hue-rotate(-18deg) brightness(0.8) contrast(1.15)',
  },
  {
    id: 'iss',
    code: '03',
    title: 'ISS',
    subtitle: 'Orbital Maintenance',
    verb: 'MAINTAIN',
    instrument: 'Spacewalk · helmet camera',
    description: 'Guide an astronaut through a spacewalk to replace a failed battery, then keep them alive through a debris storm.',
    duration: '≈ 4 min',
    enabled: true,
    image: '/textures/earth_detail.jpg',
    imagePos: '45% 50%',
    imageSize: 'auto 160%',
  },
];

export const missionEntries = (): MissionEntry[] => MISSIONS.map(({ id, code, title, enabled }) => ({ id, code, title, enabled }));
