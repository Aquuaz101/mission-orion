/**
 * Mission 02 dialogue and sample data. Sources (science.nasa.gov / mars.nasa.gov / photojournal):
 *  - Perseverance landed in Jezero Crater on 18 Feb 2021; Jezero held a lake fed by a river delta ~3.5 billion years ago.
 *  - Crater-floor rocks studied by Perseverance (e.g. near "Rochette", cored on Sol 190, 1 Sep 2021) are igneous.
 *  - Opportunity found hematite "blueberries" (concretions formed in water) at Meridiani Planum in 2004 (PIA05634).
 *  - Wildcat Ridge (delta, 2022) is a mudstone that likely formed as lake water evaporated (PIA24924).
 *  - Cheyava Falls (2024) shows features studied as a potential biosignature; not confirmed.
 *  - 2018 global dust storm ended solar-powered Opportunity's mission; "cleaning events" (wind) restored
 *    power to Spirit and Opportunity several times; Perseverance is powered by an MMRTG.
 *  - Perseverance top speed ≈ 0.152 km/h.
 * The ARES-7 emergency is fictional and labelled as such.
 */
import type { ControlMode } from '../../core/Input';

export type SampleKind = 'igneous' | 'hematite' | 'sedimentary';

export interface SampleInfo {
  kind: SampleKind;
  name: string;
  tag: string;
  image: string;
  imageCaption: string;
  facts: string[];
  collected: string[];
}

export const SAMPLES: Record<SampleKind, SampleInfo> = {
  igneous: {
    kind: 'igneous',
    name: 'Igneous rock (basaltic)',
    tag: 'Sample 1',
    image: '/images/igneous_sol190_navcam.jpg',
    imageCaption: 'Real image · Perseverance Navcam, Sol 190 (1 Sep 2021): igneous rocks on the floor of Jezero Crater, near the rock “Rochette”. NASA/JPL-Caltech',
    facts: ['Forms when magma or lava cools and hardens', 'Much of Mars’s surface is volcanic basalt', 'Perseverance found Jezero’s crater floor is made of igneous rock'],
    collected: [
      'Sample acquired: igneous rock. Much of Mars’s surface is volcanic basalt.',
      'When Perseverance drilled the crater floor here, scientists found igneous rock, formed from cooling magma, beneath the old lake bed.',
    ],
  },
  hematite: {
    kind: 'hematite',
    name: 'Hematite-bearing rock',
    tag: 'Sample 2',
    image: '/images/hematite_PIA05634.jpg',
    imageCaption: 'Real image · NASA Opportunity rover, “Berry Bowl”, Meridiani Planum, 2004 (PIA05634): hematite spherules nicknamed “blueberries”. NASA/JPL-Caltech/Cornell',
    facts: ['Hematite is an iron oxide mineral', 'Opportunity’s “blueberries” are concretions that grew in wet sediment', 'Strong evidence that liquid water once soaked the ground'],
    collected: [
      'Hematite-bearing rock acquired. In 2004, NASA’s Opportunity rover found tiny hematite spheres on Mars, nicknamed blueberries.',
      'They formed inside water-soaked sediment: strong evidence that Mars was once wet.',
    ],
  },
  sedimentary: {
    kind: 'sedimentary',
    name: 'Sedimentary rock (layered)',
    tag: 'Sample 3',
    image: '/images/sedimentary_PIA24924.jpg',
    imageCaption: 'Real image · Perseverance Mastcam-Z, Jezero delta, 4 Aug 2022 (PIA24924): the sampling area of Wildcat Ridge and Skinner Ridge. NASA/JPL-Caltech/ASU/MSSS',
    facts: ['Built from layers of sediment settled by water', 'Wildcat Ridge is a mudstone that likely formed as an ancient lake evaporated', 'Fine-grained lake rocks are prime places to search for signs of ancient life'],
    collected: [
      'Sedimentary rock acquired. Layers like these form when sediment settles out of water.',
      'In this delta, Perseverance sampled a mudstone called Wildcat Ridge, which likely formed as an ancient lake evaporated.',
      'In 2024, another rock here, Cheyava Falls, showed features scientists are studying as a possible sign of ancient life. No conclusion has been reached yet.',
    ],
  },
};

export const SAMPLE_TUBE = {
  image: '/images/sample_tube_sol190_mastcamz.jpg',
  caption: 'Real image · Perseverance Mastcam-Z, Sol 190 (1 Sep 2021): the rover’s sample tube holding its first rock core, from “Rochette”. NASA/JPL-Caltech/ASU/MSSS',
};

export const BRIEF_SPECS = [
  ['Landing site', 'Jezero Crater · 18.4° N 77.5° E'],
  ['Perseverance landed', '18 February 2021'],
  ['Terrain', 'Real HiRISE elevation · 1 m/px'],
  ['Power', 'MMRTG (nuclear) + batteries'],
] as const;

export const briefingLines = (mode: ControlMode) => [
  'Welcome to Jezero Crater, Mars. NASA’s Perseverance rover landed here on 18 February 2021.',
  'Billions of years ago this crater held a lake, fed by a river that built a delta. The ground you will drive is real: it comes from orbital elevation data of that delta.',
  mode === 'phone'
    ? 'Use the left joystick on your phone to drive and the right joystick to look around. Press interact to collect samples.'
    : 'Drive with W A S D. Drag the mouse to look around, scroll to change distance, and press E to collect samples.',
];

export const LINES = {
  start: 'Objective: collect geological samples. Drive to the first cyan marker.',
  next: 'Next sample marked. Proceed to the beacon.',
  steep: 'Slope too steep for the rover. Find a gentler route.',
  speedNote: 'For gameplay, you drive more than 100 times faster than the real Perseverance, whose top speed is around 0.15 kilometres per hour.',
  emergency: [
    { text: 'Mission Control to Rover Operator. We have detected an unexpected situation.', mood: 'alert' as const },
    { text: 'A scout rover operating nearby, ARES-7, has lost power after a severe dust storm. Its solar arrays are no longer generating enough energy.', mood: 'alert' as const },
    { text: 'Your exploration objectives are suspended. Locate ARES-7, marked in orange, and guide it to the recovery ridge.', mood: 'alert' as const },
    { text: 'Be advised: your energy reserves are declining. Time is limited.', mood: 'alert' as const },
  ],
  stormFact: 'Dust storms on Mars can grow to cover the whole planet. In 2018, a global storm blocked sunlight for weeks and ended the mission of the solar-powered Opportunity rover.',
  mmrtg: 'Your rover does not depend on sunlight. Like Perseverance, it carries a nuclear power source that charges its batteries, but hard driving drains them faster than they recharge.',
  aresNear: 'ARES-7 in range. Press interact to link its navigation to your rover.',
  linked: 'Link established. ARES-7 will follow your path. Lead it to the recovery ridge, marked in green.',
  aresReveal: [
    { text: 'There. ARES-7. Its solar arrays are buried under dust, and it has sunk into the sand.', mood: 'alert' as const },
    { text: 'Get in front of it and attach the tow cable.', mood: 'alert' as const },
  ],
  latched: 'Tow cable secured. ARES-7 is free of the sand. Take it up to the sunlit ridge. Drive carefully: you are towing extra weight.',
  intro: 'Rover systems online. Proceed up the channel to the first sample site.',
  sand: 'Soft sand slows the rover. In 2009, NASA’s Spirit rover became permanently stuck in soft Martian sand.',
  recovering: [
    'ARES-7 is on the ridge. The wind up here is clearing dust from its solar panels.',
    'Real Martian winds did this for NASA’s Spirit and Opportunity rovers: cleaning events restored their power several times.',
  ],
  restored: 'Power restored on ARES-7. Excellent work, Operator. Exploration objectives resumed.',
  sample3: 'Final objective: collect the layered sedimentary rock at the base of the outcrop.',
  fail: 'Reserves critical. ARES-7 could not be recovered in time.',
  wrap: [
    'Mission complete. All three samples are secured.',
    'Perseverance seals samples like these in tubes, so that a future mission could one day bring them back to Earth.',
  ],
};
