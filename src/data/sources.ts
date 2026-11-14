/**
 * Every dataset used in the game, with where it is used and how faithfully.
 *  real       = actual NASA/USGS data or imagery, unmodified in substance
 *  simplified = real data adapted for gameplay (scale, speed, interaction)
 *  fiction    = invented gameplay scenario, clearly labelled
 */
export type SourceKind = 'real' | 'simplified' | 'fiction';

export interface SourceEntry {
  title: string;
  usedFor: string;
  credit: string;
  url: string;
  kind: SourceKind;
}

export const SOURCES: SourceEntry[] = [
  { title: 'Jezero Crater HiRISE Digital Terrain Model (DTEEC_048842_1985_048908_1985)', usedFor: 'Mars mission terrain: real 1 m/px elevation of the Jezero delta front', credit: 'NASA/JPL-Caltech/University of Arizona · processed by USGS Astrogeology', url: 'https://stac.astrogeology.usgs.gov/', kind: 'real' },
  { title: 'MRO HiRISE image ESP_048842_1985', usedFor: 'Mars terrain surface detail and minimap', credit: 'NASA/JPL-Caltech/University of Arizona', url: 'https://www.uahirise.org/ESP_048842_1985', kind: 'real' },
  { title: 'Mars 2020 Perseverance Rover 3D model', usedFor: 'Player rover', credit: 'NASA/JPL-Caltech · NASA 3D Resources', url: 'https://github.com/nasa/NASA-3D-Resources', kind: 'real' },
  { title: 'Cassini global map of Jupiter (PIA07782)', usedFor: 'Jupiter in the telescope mission', credit: 'NASA/JPL/Space Science Institute', url: 'https://science.nasa.gov/photojournal/cassinis-best-maps-of-jupiter-cylindrical-map/', kind: 'real' },
  { title: 'Galilean moon global mosaics (Io, Europa, Ganymede, Callisto)', usedFor: 'Jupiter’s moons', credit: 'NASA/JPL · USGS · NASA 3D Resources', url: 'https://github.com/nasa/NASA-3D-Resources', kind: 'real' },
  { title: 'Hubble Space Telescope 3D model', usedFor: 'Telescope briefing', credit: 'NASA 3D Resources', url: 'https://github.com/nasa/NASA-3D-Resources', kind: 'real' },
  { title: 'Tycho star map', usedFor: 'Real night sky (including Orion) behind every space scene', credit: 'NASA 3D Resources (ESA Tycho catalogue data)', url: 'https://github.com/nasa/NASA-3D-Resources', kind: 'real' },
  { title: 'Blue Marble: Land Surface, Ocean and Ice', usedFor: 'Earth (day side) on the main menu', credit: 'NASA Earth Observatory / NASA Visible Earth', url: 'https://visibleearth.nasa.gov/images/57752', kind: 'real' },
  { title: 'Earth at Night (Black Marble)', usedFor: 'Earth city lights (night side)', credit: 'NASA Earth Observatory', url: 'https://earthobservatory.nasa.gov/features/NightLights', kind: 'real' },
  { title: 'Mars global colour mosaic', usedFor: 'Mars globe in the mission briefing', credit: 'NASA/USGS · NASA 3D Resources', url: 'https://github.com/nasa/NASA-3D-Resources', kind: 'real' },
  { title: 'Telescope operation, rover driving speed and terrain scale', usedFor: 'Controls are simplified so anyone can play; terrain relief is real but the drive is sped up', credit: 'Gameplay design', url: '', kind: 'simplified' },
  { title: 'Scout rover ARES-7 and the dust-storm rescue', usedFor: 'Emergency scenario in the Mars mission: invented, inspired by real dust-storm challenges for solar-powered rovers', credit: 'Fictional gameplay scenario', url: '', kind: 'fiction' },
];
