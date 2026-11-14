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
  'A lithium-ion battery on the station’s port truss has failed. You will see everything through the astronaut’s helmet camera and call each step of the repair.',
  mode === 'phone'
    ? 'When a decision is needed, the options appear on your phone. Tap one to give the call.'
    : 'When a decision is needed, press one, two or three, or click an option, to give the call.',
];

export const L = {
  boot: 'Helmet camera online. The astronaut is outside the Quest airlock, suit at four point three p s i of pure oxygen. We are on the night side of the planet, so helmet lights are on.',
  view: 'Take a moment, Operator. Very few people ever see this.',
  orbitFact: 'Those are city lights, four hundred and twenty kilometres below. The station is moving at about twenty-eight thousand kilometres an hour.',
  q1: 'First call. Before the astronaut lets go of the airlock, what comes first?',
  tetherOk: 'Correct. Safety tether clipped. On a spacewalk, you are always attached to the station.',
  q2: 'The worksite is out on the port truss, forty metres away. How should the astronaut get there?',
  armOk: 'Canadarm2 it is. Boots into the foot restraint on the end of the arm. The ground team will fly you there.',
  ride: 'The robotic arm is driven from Earth. Astronauts ride it to reach the far ends of the station.',
  sunrise1: 'Sunrise in thirty seconds. Look ahead, toward the horizon.',
  sunrise2: 'There it is. The station sees sixteen of these every day.',
  arrive: 'Arriving at the battery bank on the P3 truss. The faulty unit is showing a red status light. Hand over hand to the worksite.',
  q3: 'At the worksite. What first?',
  footOk: 'Good. Boots in the foot restraint. Now both hands are free to work.',
  q4: 'Battery 3B is failed. Choose the safe sequence.',
  seqOk: 'Correct. Isolate the power first, so the connectors are dead before anyone touches them.',
  bolts: 'New unit seated. Driving the four bolts with the pistol grip tool, twenty-five foot-pounds each.',
  boltsDone: 'All four bolts torqued.',
  connIntro: 'Now reconnect the three power cables. The connectors are keyed: match each plug to its socket shape.',
  connWrong: 'Keying mismatch. These plugs are shaped so they cannot be forced into the wrong socket. Try another.',
  connDone: 'All three connectors mated. Power to the new battery.',
  powerUp: 'Telemetry confirms the new battery is online. Green light on unit 3B.',
  debris1: { text: 'Operator, stand by. Mission Control has a debris alert. A fragment cloud is crossing our orbit.', mood: 'alert' as const },
  debris2: { text: 'The cloud is coming from behind the station, and the airlock is forty metres away. Make the call.', mood: 'alert' as const },
  coverOk: { text: 'Good call. Tools stowed. Stay on this side of the truss and let the station take the hits.', mood: 'alert' as const },
  q6: { text: 'Fragments crossing now. How does the astronaut hold?', mood: 'alert' as const },
  shieldOk: { text: 'Both hands on the rail. Visor down. Let the truss take it.', mood: 'alert' as const },
  impact: { text: 'Strike on the solar array. Hold on. You are shielded.', mood: 'alert' as const },
  allClear: 'The cloud has passed. Suit pressure steady at four point three. The astronaut is safe, Operator.',
  wrap1: 'Battery 3B is online, and the astronaut rode out the storm. Spacewalk objectives complete.',
  wrap2: 'In November 2021, real debris from an anti-satellite test sent the station’s crew to shelter in their spacecraft. Every piece of debris is a danger to everyone in orbit.',
  wrong: {
    push: 'Never leave without a tether. If you drift away, there is nothing to push against.',
    safer: 'SAFER is the emergency jet pack, for self-rescue only. Spacewalkers use the handrails.',
    gloves: 'Absolutely not. In a vacuum, that would be fatal in seconds. The gloves stay on.',
    arm: 'The robotic arm is busy on the other side of the station today. Handrails, please.',
    unbolt: 'Unbolting first would leave live power connectors hanging free. Isolate the power first.',
    rush: 'Unsafe. The battery is still connected to the power grid.',
    finish: 'There is no time for that. Debris travels faster than a bullet.',
    airlock: 'Forty metres of open truss with the cloud arriving? The station itself is the best shield. Get behind it.',
    look: 'At eight kilometres a second there is nothing to dodge. Visor down, hands on the rail.',
    letGo: 'Let go of the station in a debris storm? Stay attached and stay behind the truss.',
  },
};

export interface Choice { label: string; sub?: string; ok: boolean; why?: string }

export const CHOICES = {
  q1: [
    { label: 'Clip the safety tether', sub: 'Attach to the ring by the hatch', ok: true },
    { label: 'Push off toward the worksite', sub: 'Save time', ok: false, why: L.wrong.push },
    { label: 'Fire the SAFER jet pack', sub: 'Test the thrusters', ok: false, why: L.wrong.safer },
  ],
  q2: [
    { label: 'Fly with the SAFER jet pack', sub: 'Fastest route', ok: false, why: L.wrong.safer },
    { label: 'Ride Canadarm2', sub: 'Foot restraint on the robotic arm', ok: true },
    { label: 'Push off and float across', sub: 'Straight line', ok: false, why: L.wrong.push },
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
    { label: 'Take cover behind the truss', sub: 'Put the station between you and the cloud', ok: true },
    { label: 'Race back to the airlock', sub: '40 m of open truss', ok: false, why: L.wrong.airlock },
  ],
  q6: [
    { label: 'Watch the fragments', sub: 'Track them and dodge', ok: false, why: L.wrong.look },
    { label: 'Both hands on the rail, visor down', sub: 'Face the truss', ok: true },
    { label: 'Let go and drift clear', sub: 'Get away from the station', ok: false, why: L.wrong.letGo },
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
