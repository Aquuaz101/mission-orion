/**
 * Commander dialogue for Mission 01. Facts are from NASA sources:
 *  - Hubble: science.nasa.gov/mission/hubble (launch 24 Apr 1990, 2.4 m mirror, f/24 optics, WFC3,
 *    one-gyro operations since 2024, OPAL yearly outer-planet program)
 *  - Jupiter: science.nasa.gov/jupiter (largest planet, ~11x Earth's diameter, ~10 h day,
 *    ammonia/water clouds, Great Red Spot: storm larger than Earth, shrinking, observed since 1800s)
 *  - Galilean moons: discovered by Galileo Galilei in January 1610
 *  - Europa: science.nasa.gov/jupiter/moons/europa (subsurface salty ocean with ~2x Earth's ocean water;
 *    Europa Clipper launched 14 Oct 2024)
 *  - JWST: science.nasa.gov/mission/webb (2022 Jupiter infrared images: auroras, rings; orbits ~1.5 million km from Earth)
 */
import type { ControlMode } from '../../core/Input';

export const HUBBLE_SPECS = [
  ['Launched', '24 April 1990'],
  ['Primary mirror', '2.4 m'],
  ['Orbit', '≈ 500 km above Earth'],
  ['Instrument', 'Wide Field Camera 3'],
] as const;

export const briefingLines = (mode: ControlMode) => [
  'Welcome to the Deep Space Observatory. Today we will observe Jupiter with the Hubble Space Telescope. I will handle the guidance; you take the pictures.',
  'Hubble launched in 1990. Orbiting above our atmosphere, its 2.4 metre mirror sees without the blur that limits telescopes on the ground.',
  mode === 'phone'
    ? 'Drag on your phone’s touch pad to point the telescope. Use the zoom buttons and the focus slider, then press capture.'
    : 'Drag with the mouse or use W A S D to point the telescope. Scroll to zoom, Z and X to focus, and Space to capture.',
];

export const OBJECTIVES = [
  {
    id: 'disk',
    code: 'A',
    title: 'Full planetary observation',
    short: 'Frame Jupiter’s entire disk',
    start: 'Objective one: frame Jupiter’s entire disk. Centre the planet, zoom until it fills the brackets, then sharpen the focus.',
    success: [
      'Observation confirmed. Jupiter is the largest planet in our solar system, about eleven times wider than Earth.',
      'Those coloured bands are clouds of ammonia and water, stretched around the planet by powerful east and west winds.',
    ],
    caption: 'Jupiter · full disk',
  },
  {
    id: 'grs',
    code: 'B',
    title: 'Great Red Spot observation',
    short: 'Centre and capture the Great Red Spot',
    start: 'Objective two: the Great Red Spot, in the southern hemisphere. A day on Jupiter lasts only about ten hours, so track the storm as it rotates into view.',
    success: [
      'Great Red Spot captured. This storm is wider than Earth, and astronomers have watched it for more than 150 years.',
      'Hubble has measured it shrinking over the decades. Watching how it changes is one reason Hubble returns to Jupiter every year.',
    ],
    caption: 'Great Red Spot',
  },
  {
    id: 'europa',
    code: 'C',
    title: 'Jupiter moon observation',
    short: 'Find and capture Europa',
    start: 'Final objective: Europa, one of the four large moons Galileo discovered in 1610. Zoom out and look to the left of Jupiter: Europa is the nearest moon on that side.',
    success: [
      'Europa acquired. Beneath its icy shell, scientists think there is a salty ocean holding about twice as much water as all of Earth’s oceans.',
      'NASA’s Europa Clipper launched in 2024 to investigate whether that ocean could support life.',
    ],
    caption: 'Europa',
  },
] as const;

export type ObjectiveId = (typeof OBJECTIVES)[number]['id'];

export const HINTS = {
  noTarget: 'The target is not in the frame. Pan the telescope toward it.',
  offCentre: 'Almost. Centre the target in the frame, then capture.',
  tooSmall: 'The target is too small. Zoom in.',
  tooLarge: 'Too close. Zoom out until the whole target fits the brackets.',
  focus: 'The image is soft. Adjust the focus until the fine detail sharpens.',
  over: 'Overexposed: the bright clouds are clipping. Lower the exposure.',
  under: 'Too dark. Raise the exposure.',
  grsHidden: 'The Great Red Spot is on the far side. Wait for Jupiter’s rotation to bring it around.',
  refocus: 'Zooming shifts the focus. Re-focus after every zoom.',
  ambient: 'Every year Hubble’s OPAL programme maps Jupiter, building a long-term record of its changing weather.',
};

export const LOCKED = 'Target locked. Ready when you are.';

export const WRAP_UP = [
  'All three observations are complete. Excellent work, Operator.',
  'Scientists combine images like these over many years to track how Jupiter’s atmosphere changes.',
];

export const JWST_NOTE = {
  title: 'Seen in infrared: James Webb Space Telescope',
  text: 'In 2022, NASA’s James Webb Space Telescope imaged Jupiter in infrared light, revealing glowing auroras at its poles and its faint rings. Webb orbits the Sun about 1.5 million km from Earth. It observes Jupiter from there, not from Jupiter itself.',
};
