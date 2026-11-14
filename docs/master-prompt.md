# PROJECT MISSION: ORION
## NASA SPACE APPS CHALLENGE — 24-HOUR GAME DEVELOPMENT BRIEF

You are acting as our lead game developer, technical architect, UI/UX designer, 3D game designer, and rapid prototyping engineer.

Your responsibility is to help us build a visually impressive, interactive, educational 3D space mission simulation game for the NASA Space Apps Challenge.

We have ONLY 24 HOURS to develop this project.

This is the most important constraint of the entire project.

# 1. DEVELOPMENT PHILOSOPHY: BUILD THE WOW, NOT THE ENTIRE GAME

We are deliberately using a strategic development approach.

We DO NOT want a fully fleshed-out commercial game.

We DO NOT want to waste time building unnecessary mechanics, massive environments, complicated physics systems, extensive storylines, sophisticated AI infrastructure, or features that will never be demonstrated.

Instead, we want to develop a carefully selected collection of highly polished, interactive experiences that make the game FEEL like a complete NASA space simulation.

Think of this as a vertical-slice demonstration.

We want the most impressive 20% of the game that communicates 100% of the intended experience.

Every feature must justify its development time.

Prioritize the following, in order:

1. Visually impressive environments and presentation.
2. Two fully demonstrable missions.
3. Smartphone-as-controller functionality.
4. Immersive spacecraft operation interfaces.
5. AI commander with educational information and mission guidance.
6. Accurate NASA scientific information.
7. A polished mission selection screen and transitions.
8. Optional third mission, only after everything above works.

Do not spend hours implementing features that contribute little to the actual presentation.

If a complex feature can be convincingly represented through a simpler interactive animation, scripted sequence, or visual effect, use the simpler solution.

However, the game must remain genuinely interactive. We are not creating a slideshow or a prerecorded cinematic disguised as a game.

The player must actually control the telescope and rover.

# 2. GAME IDENTITY

Game title: MISSION: ORION

Tagline: BRING THE NASA EXPERIENCE TO YOUR HOME.

Concept:

MISSION: ORION is an interactive space exploration and mission operation simulator that allows players to experience the responsibilities of operating NASA-inspired spacecraft, scientific instruments, and robotic exploration systems.

Players become remote mission operators.

They operate astronomical observation instruments, pilot planetary rovers, collect scientific samples, and respond to unexpected mission situations.

An AI commander accompanies the player throughout their missions, providing operational instructions, scientific explanations, spacecraft information, and mission updates.

The game should communicate three main experiences:

- OBSERVE: Conduct astronomical observations.
- EXPLORE: Pilot robotic explorers across other worlds.
- MAINTAIN: Operate robotic systems to maintain orbital infrastructure.

# 3. TECHNICAL APPROACH

Before developing anything:

1. Inspect the existing project and identify its current framework, installed dependencies, and working features.
2. Determine the fastest reliable way to build the game using the existing environment.
3. Do not unnecessarily replace an existing working framework.
4. Establish a simple, modular architecture.
5. Prioritize getting a playable version working as early as possible.

If starting from scratch, select a practical framework capable of delivering a 3D browser-accessible experience.

Preferred considerations:
- Three.js or React Three Fiber for browser-based 3D.
- React for interfaces, if appropriate.
- WebSockets for communication between the game and phone controller.
- A lightweight local server for controller pairing.

Do not introduce unnecessary frameworks.

The final project must be runnable locally on a PC.

It must also support a smartphone browser controller connected to the PC through a local connection.

Provide clear instructions for launching the PC game and connecting the phone.

# 4. MISSION 01: JUPITER — DEEP SPACE OBSERVATORY

PRIORITY: VERY HIGH.

This mission is our astronomical observation experience.

The player operates a simulated space telescope to conduct three observations of Jupiter.

The mission must have three objectives:

OBJECTIVE A: FULL PLANETARY OBSERVATION

- Locate Jupiter.
- Adjust the observation camera.
- Frame the entire visible planetary disk.
- Capture an image.
- Display a successful observation notification.

OBJECTIVE B: GREAT RED SPOT OBSERVATION

- Adjust the observation framing and zoom.
- Locate the Great Red Spot.
- Center the storm within the observation frame.
- Capture an image.
- Provide scientific information about the storm.

OBJECTIVE C: JUPITER MOON OBSERVATION

- Locate one of Jupiter's Galilean moons, preferably Europa.
- Adjust the camera framing.
- Capture the moon.
- Display relevant scientific information.

IMPORTANT VISUAL REQUIREMENTS:

The telescope interface must be one of the game's most polished features.

The experience should feel like operating a real astronomical imaging instrument.

Use an immersive camera-based observation interface rather than displaying the player inside a conventional 3D environment.

The telescope's observation screen should occupy most of the display.

Include:

- Telescope name in the top-left corner.
- Mission name and current observation objective.
- Observation target information.
- Camera movement controls.
- Zoom controls.
- Focus adjustment.
- Exposure time.
- Aperture information where applicable.
- Observation reticle.
- Instrument status.
- Image capture button.
- Observation progress.
- Image gallery showing successfully captured observations.

Use the Hubble Space Telescope as the primary simulated visible-light observation instrument.

You may introduce the James Webb Space Telescope through an additional information panel or a separate infrared observation reference.

Do not falsely claim that JWST orbits Jupiter.

The game may simplify the physical operation of a telescope for accessibility, but scientific information must remain accurate.

The player should use the smartphone controller to move the observation frame, adjust zoom and focus, and capture images.

IMPORTANT GAMEPLAY REQUIREMENT:

The player must actually manipulate the camera framing.

Do not simply provide three buttons that automatically capture three predetermined images.

Use a controlled camera system that lets players move and zoom toward the intended observation targets.

The objective system can recognize when the player has framed the correct target.

After every successful capture, display an image preview, observation confirmation, and a short AI commander explanation.

# 5. MISSION 02: MARS — RED PLANET EXPEDITION

PRIORITY: VERY HIGH.

This is our main 3D exploration mission.

The player operates a simulated Mars exploration rover.

The environment should be a relatively small but visually impressive Martian landscape.

We do NOT need a massive open world.

A compact, carefully designed environment with impressive terrain, lighting, atmospheric effects, and geological formations is sufficient.

VISUAL REQUIREMENTS:

- Red and orange Martian terrain.
- Rocky formations.
- Detailed ground textures.
- Atmospheric haze.
- Realistic shadows.
- Sunlight and environmental lighting.
- Dust particles.
- Rover tracks.
- A recognizable exploration rover.
- A few scattered geological samples.

The player should have a third-person camera following the rover.

ROVER CONTROLS:

The player must be able to:

- Move forward and backward.
- Turn left and right.
- Adjust the camera.
- Stop and inspect the environment.
- Interact with geological samples.
- Collect samples.

Use simple but believable rover movement. Do not waste time creating a complicated suspension or wheel simulation.

PHASE A: GEOLOGICAL EXPLORATION

The player must collect three geological samples.

Suggested sample categories:

1. Basaltic rock.
2. Hematite-bearing rock.
3. Sedimentary rock.

These must be presented as educational discoveries inspired by real Martian geology.

For each sample:

- Display an identifiable marker.
- Allow the player to approach it.
- Provide an interaction prompt.
- Play a short robotic-arm collection animation.
- Add the sample to the collection inventory.
- Trigger a relevant AI commander explanation.

Use actual NASA geological discoveries as the foundation of the information.

Do not claim that the fictional samples are actual physical specimens collected by the player's simulated rover.

PHASE B: EMERGENCY ROVER RECOVERY

This is the major unexpected event and the most important gameplay twist in the Mars mission.

After the player has collected two geological samples, trigger an emergency announcement.

The AI commander should interrupt the normal exploration sequence.

Example:

"Mission Control to Rover Operator. We have detected an unexpected situation."

"An exploration rover operating nearby has experienced a critical power reduction following a severe Martian dust storm. Its solar arrays are no longer generating sufficient power."

"Your exploration objectives are temporarily suspended. Locate the affected rover and guide it toward the designated recovery area."

"Be advised: your own energy reserves are declining. Time is limited."

GAMEPLAY REQUIREMENTS:

1. Introduce a countdown timer.
2. Display the player's rover battery.
3. Show a navigation marker indicating the stranded rover's approximate location.
4. Introduce a dust storm atmospheric effect.
5. Reduce visibility appropriately.
6. Allow the player to navigate toward the stranded rover.
7. Trigger an interaction when the player reaches it.
8. Guide the player toward a recovery location.
9. Display a successful recovery animation and mission completion.

The emergency should feel dramatic.

Use sound effects, atmospheric changes, UI alerts, and AI dialogue to communicate urgency.

The emergency does not need complicated AI pathfinding.

Use a predefined navigation route or simple recovery waypoint system.

IMPORTANT SCIENTIFIC ACCURACY:

Mars experiences dust storms, and dust accumulation on solar panels can reduce their power generation.

However, the emergency scenario is fictional and should be described as a simulated incident inspired by actual Martian environmental challenges.

Do not misrepresent this as an actual NASA rover incident.

# 6. MISSION 03: ISS — ORBITAL MAINTENANCE

PRIORITY: LOW. OPTIONAL.

Only implement this after the first two missions are working and polished.

This is a short robotic maintenance minigame.

The player operates a simplified robotic maintenance arm inspired by the International Space Station's Canadarm2 or Dextre.

The player must:

- Move the robotic arm.
- Rotate its end effector.
- Align with a malfunctioning component.
- Grab the component.
- Replace or reposition it.
- Confirm the maintenance operation.

Keep this experience approximately 30–45 seconds long.

It should be a visually impressive interactive sequence, not a full simulation.

Include information about the actual functions of Canadarm2 and Dextre.

# 7. SMARTPHONE-AS-CONTROLLER SYSTEM

THIS IS ONE OF THE MOST IMPORTANT DIFFERENTIATING FEATURES.

We want the smartphone to function as a dedicated spacecraft controller.

The game runs on the PC, while the phone acts as the physical remote-control interface.

The player must not be required to use WASD as their primary gameplay input.

TECHNICAL REQUIREMENTS:

- PC runs the 3D simulation.
- Smartphone opens a browser-based controller.
- Both communicate through a local WebSocket connection.
- The PC displays a QR code or pairing address.
- The phone connects to the PC's local server.
- The phone displays a controller interface specific to the selected mission.

Prefer a reliable same-Wi-Fi connection.

If USB tethering can be supported through the existing networking architecture, provide it as an alternative.

Do not waste time attempting to create a native USB HID controller.

CONTROLLER INTERFACE:

JUPITER:

- Virtual joystick or directional touch area for observation framing.
- Zoom in and out.
- Focus adjustment.
- Capture button.

MARS:

- Left virtual joystick for rover movement.
- Right virtual joystick for camera movement.
- Interaction button.
- Emergency mission navigation indicator.

ISS:

- Arm movement controls.
- Rotation controls.
- Grip/release button.

The controller should have a clean, futuristic, NASA-inspired appearance.

Display connection status prominently.

The game must also have a keyboard fallback so the demonstration can continue if the phone disconnects.

IMPORTANT:

Do not create a fake phone controller that only displays an interface without controlling the game.

Every controller input must actually affect the corresponding game action.

# 8. AI COMMANDER SYSTEM

The AI commander is the central personality of the experience.

It should feel like a mission-control assistant accompanying the player throughout the simulation.

Its responsibilities include:

- Introducing missions.
- Explaining the spacecraft being operated.
- Providing operational instructions.
- Teaching the player how to use controls.
- Explaining newly discovered samples.
- Communicating mission progress.
- Announcing emergencies.
- Providing environmental information.
- Giving mission completion reports.

The AI must not only speak when an object is discovered.

It should provide contextual information throughout the experience.

For example:

Before the Jupiter mission:

"Welcome to the Deep Space Observatory. Today, we will conduct a series of observations of Jupiter using the Hubble Space Telescope."

During telescope operation:

"Remember that Hubble observes Jupiter at visible and other wavelengths, allowing scientists to monitor atmospheric changes over time."

During Mars exploration:

"Your rover is equipped with scientific instruments designed to investigate Martian geology and environmental conditions."

During sample collection:

"Sample acquired. Its geological characteristics may provide clues about the environmental history of this region."

TECHNICAL IMPLEMENTATION:

Prefer a structured, event-driven dialogue system.

Create a knowledge database containing verified facts.

Each important gameplay event should trigger a corresponding dialogue entry.

If an existing, tested AI API is available, conversational features may be added as an enhancement.

Do not make essential mission functionality dependent on a live AI API.

The game must remain fully playable without internet access.

# 9. SCIENTIFIC ACCURACY AND NASA DATA

This is a NASA Space Apps Challenge project.

Scientific accuracy is important.

We want real NASA information integrated into the gameplay rather than generic space trivia.

Use authoritative NASA sources.

Suggested references:

JUPITER:
- NASA Hubble Space Telescope.
- NASA James Webb Space Telescope.
- NASA Juno mission.
- Jupiter's Great Red Spot.
- Jupiter's Galilean moons.
- NASA observations of Jupiter's atmosphere.

MARS:
- NASA Perseverance rover.
- NASA Curiosity rover.
- NASA Sojourner rover.
- Jezero Crater.
- Martian geology.
- Hematite and sedimentary rocks.
- Martian dust storms.
- Solar-panel power challenges.

ISS:
- Canadarm2.
- Dextre.
- International Space Station maintenance.
- Robotic assembly and servicing.

Useful official sources:

https://science.nasa.gov/

https://www.nasa.gov/

https://mars.nasa.gov/

https://science.nasa.gov/mission/hubble/

https://science.nasa.gov/mission/webb/

https://science.nasa.gov/mission/mars-2020-perseverance/

https://www.nasa.gov/international-space-station/mobile-servicing-system/

Use actual NASA imagery and public scientific resources where practical.

Do not spend excessive time implementing live NASA API integrations if curated, verified NASA data and images can achieve the same presentation.

If external data is integrated, ensure the game has local fallback content.

IMPORTANT:

Never invent scientific facts, spacecraft specifications, mission dates, discoveries, or historical events.

Clearly distinguish between:

1. Actual NASA information.
2. Simplified educational representations.
3. Fictional gameplay scenarios.

Where possible, provide a small Sources or Mission Data section that identifies the NASA references used.

# 10. VISUAL DESIGN AND GRAPHICS

The overall game should resemble a polished indie 3D space simulation.

We want something between a realistic space simulator and an accessible indie game.

Do not aim for photorealism at the expense of performance or development time.

VISUAL PRIORITIES:

- Cinematic lighting.
- Detailed environments.
- High-quality materials.
- Smooth camera transitions.
- Realistic shadows.
- Ambient occlusion.
- Atmospheric fog.
- Particle effects.
- Subtle bloom.
- Screen-space reflections where appropriate.
- Polished interfaces.
- Responsive animations.

Use hardware ray tracing only if it is already practical and does not compromise performance.

Baked lighting and other efficient rendering techniques are acceptable.

The Jupiter mission should prioritize the quality of the observation interface and astronomical imagery.

The Mars mission should prioritize the 3D environment, rover model, lighting, atmosphere, and emergency sequence.

The overall UI should use a consistent visual identity.

Suggested palette:
- Deep navy.
- Black.
- White.
- Muted blue.
- Small orange and cyan highlights.

Avoid excessive neon, excessive visual clutter, and generic AI-generated-looking interfaces.

The finished product should feel like an actual software product.

# 11. USER INTERFACE AND GAME FLOW

The game should follow this sequence:

1. Intro/loading screen.
2. Main menu.
3. Brief game introduction.
4. Mission selection.
5. Mission briefing.
6. Controller connection/pairing.
7. Mission gameplay.
8. Mission completion.
9. Scientific discoveries summary.
10. Return to mission selection.

The main menu should be visually impressive.

Display the three mission categories as attractive mission cards.

The first two missions must be accessible and playable.

The third may be marked as optional or under development if it cannot be completed.

# 12. DEVELOPMENT PRIORITIES AND TIME MANAGEMENT

We have 24 hours.

Do not attempt to complete every feature before testing the game.

Use the following development strategy:

PHASE 1 — CORE FOUNDATION

- Project setup.
- Main menu.
- Global UI system.
- Mission selection.
- Basic 3D environment.
- Controller connection architecture.

PHASE 2 — JUPITER

- Observation environment.
- Telescope interface.
- Camera framing and zoom.
- Three observation targets.
- Image capture and gallery.
- AI dialogue.

PHASE 3 — MARS

- 3D Martian environment.
- Rover model and movement.
- Sample collection.
- Geological information.
- Emergency event.
- Countdown and recovery objective.

PHASE 4 — POLISH

- Lighting.
- Particles.
- Animations.
- Sound effects.
- Transitions.
- UI refinements.
- Controller testing.

PHASE 5 — OPTIONAL ISS

Only if the mandatory missions are already playable and stable.

PHASE 6 — PRESENTATION TEST

Run the entire experience from beginning to end.

Fix crashes, broken controls, disconnected interfaces, missing assets, and mission progression errors.

Do not introduce risky new features at the last minute.

# 13. STRICT DEVELOPMENT RULES

Follow these rules throughout development:

1. NEVER overengineer.
2. NEVER create unnecessary systems.
3. NEVER prioritize optional content over mandatory missions.
4. NEVER sacrifice working functionality for visual experimentation.
5. NEVER use placeholder buttons that do nothing.
6. NEVER create a fake controller connection.
7. NEVER depend on an internet connection for essential gameplay.
8. NEVER introduce scientific misinformation.
9. NEVER spend excessive time on features that won't be demonstrated.
10. ALWAYS test after implementing important features.

Use simple, maintainable code.

Keep mission logic modular.

Use lightweight assets where possible.

If an asset is unavailable, use a visually convincing alternative rather than stopping development.

If something is too complicated, propose a simplified implementation that preserves the intended experience.

# 14. FIVE-MINUTE PRESENTATION OPTIMIZATION

The entire game will be demonstrated in approximately five minutes.

Design the game around this constraint.

The experience must quickly communicate:

- What the game is.
- Why it is educational.
- How the player operates spacecraft.
- Why the phone controller is innovative.
- How real NASA science is incorporated.

Suggested demonstration sequence:

0:00–0:30 — Introduction and main menu.

0:30–0:50 — Connect the smartphone controller.

0:50–2:00 — Jupiter telescope observation.

2:00–4:20 — Mars exploration, sample collection, and emergency rover recovery.

4:20–5:00 — Scientific summary, NASA data sources, and project impact.

The optional ISS mission should only be demonstrated if time permits.

Make mission transitions fast.

Provide a demo-ready way to skip lengthy briefings without skipping important gameplay.

Allow the player to enter missions immediately.

# 15. HOW YOU SHOULD WORK WITH US

We want you to act as an active technical development partner.

Do not simply explain how to build the game. Help us actually build it.

Start by inspecting the existing project.

Then provide:

1. A recommended technical architecture.
2. The essential project structure.
3. A prioritized implementation plan.
4. The first working version of the game.

Do not spend excessive time discussing architecture before writing working code.

Implement features incrementally.

After each major milestone:

- Explain what was implemented.
- Identify what is functional.
- Identify what still needs work.
- Provide exact commands for testing.
- Tell us the next highest-priority task.

If you need to choose between a beautiful feature that does not work and a simpler feature that actually works, choose the working feature and make it look good.

We are aiming for a polished, memorable, interactive demonstration, not a complete commercial game.

# FINAL OBJECTIVE

Deliver a working 3D space mission simulation that makes the player feel like a real NASA mission operator.

The two essential experiences are:

1. Operating a telescope to observe Jupiter.
2. Piloting a Mars rover, collecting geological samples, and responding to an emergency recovery mission.

The smartphone controller must genuinely operate the PC game.

The AI commander must provide educational information and mission guidance throughout the experience.

The visuals must be impressive enough to capture attention during a five-minute live demonstration.

Remember:

WE HAVE 24 HOURS.

BUILD THE WOW MOMENTS.

MAKE THEM WORK.

MAKE THEM BEAUTIFUL.

DO NOT BUILD WHAT WE DO NOT NEED.