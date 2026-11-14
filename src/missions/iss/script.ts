/**
 * Mission 03 dialogue + facts. Sources (nasa.gov):
 *  - ISS: orbits ≈ 400–420 km up at ≈ 28,000 km/h (17,500 mph), circling Earth about every 90 minutes,
 *    so the crew sees about 16 sunrises and sunsets a day; ≈ 109 m end to end (nasa.gov/international-space-station).
 *  - Spacewalks: astronauts stay tethered at all times; SAFER is a small jet pack worn only for self-rescue
 *    if a tether fails. They move hand over hand along handrails; tools are tethered too.
 *  - EMU spacesuit is pressurised to ≈ 4.3 psi of pure oxygen.
 *  - Pistol Grip Tool: NASA's battery-powered, programmable torque tool used on spacewalks.
 *  - 2017–2021: spacewalkers replaced the station's nickel-hydrogen batteries with lithium-ion ORUs
 *    (Orbital Replacement Units) on the P4/P6/S4/S6 truss; one Li-ion battery replaced two older ones.
 *  - 15 Nov 2021: a Russian anti-satellite (ASAT) test destroyed the defunct Kosmos-1408 satellite,
 *    creating more than 1,500 trackable fragments; the ISS crew sheltered in their docked spacecraft
 *    as the station passed near the cloud. A spacewalk planned for 30 Nov was postponed because of debris.
 *  - The station carries Whipple shields against micrometeoroids and orbital debris (MMOD) and
 *    performs debris-avoidance manoeuvres when a conjunction is predicted.
 * The battery failure and the debris alert during this spacewalk are dramatised and labelled as such.
 */
import type { ControlMode } from '../../core/Input';

export const ISS_SPECS = [
  ['Altitude', '≈ 420 km'],
  ['Speed', '≈ 28,000 km/h'],
  ['One orbit', '≈ 92 minutes'],
  ['Length', '≈ 109 m end to end'],
] as const;

export const briefingLines = (mode: ControlMode) => [
  'Welcome to Mission Control, Operator. Today you are the spacewalk officer for an astronaut outside the International Space Station.',
  'A lithium-ion battery on the P4 truss has failed. You will see everything through the astronaut’s helmet camera and call each step of the repair.',
  mode === 'phone'
    ? 'When a decision is needed, the options appear on your phone. Tap one to give the call.'
    : 'When a decision is needed, press one, two or three, or click an option, to give the call.',
];

export const L = {
  boot: 'Helmet camera online. Suit pressure four point three p s i. Pure oxygen. The astronaut is ready at the hatch.',
  hatch: 'Opening the hatch. Take a moment, Operator. Very few people ever see this.',
  orbitFact: 'The station is four hundred and twenty kilometres up, moving at about twenty-eight thousand kilometres an hour. That is the Caribbean sliding by below.',
  q1: 'First call. What does the astronaut do before leaving the airlock?',
  tetherOk: 'Correct. Safety tether clipped. On a spacewalk, you are always attached to the station.',
  q2: 'The worksite is twenty-five metres along the truss. How should the astronaut get there?',
  railsOk: 'Hand over hand along the handrails. Slow is smooth, and smooth is fast.',
  translating: 'The yellow handrails run the length of the station. Every tool, and every astronaut, stays tethered.',
  arrive: 'Arriving at the P4 battery bank. The faulty unit is showing a red status light.',
  q3: 'At the worksite. What first?',
  footOk: 'Good. Boots in the foot restraint. Now both hands are free to work.',
  q4: 'Battery 3B is failed. Choose the safe sequence.',
  seqOk: 'Correct. Isolate the power first, so the connectors are dead before anyone touches them.',
  torqueIntro: 'Unit swapped in. Drive the four bolts with the pistol grip tool. Stop the needle in the green band, about twenty-five foot-pounds.',
  torqueMiss: 'Not quite. The tool backed off. Try that bolt again.',
  torqueDone: 'All four bolts torqued. Nicely done.',
  connIntro: 'Now reconnect the three power cables. The connectors are keyed: match each plug to its socket shape.',
  connWrong: 'Keying mismatch. These plugs are shaped so they cannot be forced into the wrong socket. Try another.',
  connDone: 'All three connectors mated. Power to the new battery.',
  powerUp: 'Telemetry confirms the new battery is online. Green light on unit 3B.',
  debris1: { text: 'Operator, stand by. Mission Control has a debris alert. A fragment cloud is crossing our orbit.', mood: 'alert' as const },
  debris2: { text: 'We need the astronaut inside, now. Make the call.', mood: 'alert' as const },
  returnOk: { text: 'Good call. Tools stowed. Head for the airlock.', mood: 'alert' as const },
  q6: { text: 'Fragments ahead. Hold behind the truss, or keep moving?', mood: 'alert' as const },
  shieldOk: { text: 'Hold. Let the truss take it.', mood: 'alert' as const },
  impact: { text: 'Impact on the array. Keep moving, Operator.', mood: 'alert' as const },
  hatchClose: 'Hatch closed. Repressurising. Welcome back inside.',
  wrap1: 'Spacewalk complete. The new battery is online and the crew is safe.',
  wrap2: 'In November 2021, real debris from an anti-satellite test sent the station’s crew to shelter in their spacecraft. Every piece of debris is a danger to everyone in orbit.',
  wrong: {
    push: 'Never leave without a tether. If you drift away, there is nothing to push against.',
    safer: 'SAFER is the emergency jet pack, for self-rescue only. Spacewalkers use the handrails.',
    gloves: 'Absolutely not. In a vacuum, that would be fatal in seconds. The gloves stay on.',
    arm: 'The robotic arm is busy on the other side of the station today. Handrails, please.',
    unbolt: 'Unbolting first would leave live power connectors hanging free. Isolate the power first.',
    rush: 'Unsafe. The battery is still connected to the power grid.',
    finish: 'There is no time for that. Debris travels faster than a bullet.',
    shelter: 'A battery box is no shelter. The airlock is.',
    keepGoing: 'Into the fragment stream? Stay behind the truss until it passes.',
  },
};

export interface Choice { label: string; sub?: string; ok: boolean; why?: string }

export const CHOICES = {
  q1: [
    { label: 'Clip the safety tether', sub: 'Attach to the airlock rail', ok: true },
    { label: 'Push off toward the worksite', sub: 'Save time', ok: false, why: L.wrong.push },
    { label: 'Fire the SAFER jet pack', sub: 'Test the thrusters', ok: false, why: L.wrong.safer },
  ],
  q2: [
    { label: 'Fly with the SAFER jet pack', sub: 'Fastest route', ok: false, why: L.wrong.safer },
    { label: 'Hand over hand along the rails', sub: 'Yellow handrails on the truss', ok: true },
    { label: 'Ride the robotic arm', sub: 'Canadarm2', ok: false, why: L.wrong.arm },
  ],
  q3: [
    { label: 'Remove gloves for dexterity', sub: 'Fine work ahead', ok: false, why: L.wrong.gloves },
    { label: 'Unbolt the battery right away', sub: 'Get it done', ok: false, why: L.wrong.rush },
    { label: 'Lock boots into the foot restraint', sub: 'Stabilise first', ok: true },
  ],
  q4: [
    { label: 'Isolate power → disconnect → unbolt', sub: 'Then swap the unit', ok: true },
    { label: 'Unbolt → swap → disconnect', sub: 'Fastest sequence', ok: false, why: L.wrong.unbolt },
    { label: 'Disconnect → unbolt → isolate power', sub: 'Cables first', ok: false, why: L.wrong.rush },
  ],
  q5: [
    { label: 'Finish the cable inspection', sub: '2 minutes of work left', ok: false, why: L.wrong.finish },
    { label: 'Stow tools, return to the airlock', sub: 'Abort the spacewalk', ok: true },
    { label: 'Shelter behind the battery box', sub: 'Stay put', ok: false, why: L.wrong.shelter },
  ],
  q6: [
    { label: 'Hold behind the truss', sub: 'Let it pass', ok: true },
    { label: 'Keep moving', sub: 'Race the cloud', ok: false, why: L.wrong.keepGoing },
  ],
} satisfies Record<string, Choice[]>;

export const CONNECTORS = [
  { id: 'J1', shape: 'circle', name: 'J1 · main power', color: '#ffd04d' },
  { id: 'J2', shape: 'triangle', name: 'J2 · data', color: '#4fd8ff' },
  { id: 'J3', shape: 'square', name: 'J3 · heater', color: '#ff7a59' },
] as const;

export const FACTS = [
  ['Orbit', 'The ISS circles Earth about every 90 minutes at ≈ 28,000 km/h, so its crew sees about 16 sunrises a day.'],
  ['Tethers', 'Spacewalkers are always tethered. SAFER, a small jet pack, is only for self-rescue if a tether fails.'],
  ['Batteries', 'Between 2017 and 2021, spacewalkers replaced the station’s nickel-hydrogen batteries with lithium-ion units. One new battery replaced two old ones.'],
  ['Debris', 'On 15 Nov 2021 an anti-satellite test shattered the Kosmos-1408 satellite into 1,500+ trackable fragments. The ISS crew sheltered in their spacecraft.'],
] as const;
