# Tagging Guide

Tags are supplemental discovery labels. They should help users filter for reusable type, function, material, interface, or feature concepts that are not already captured by a dedicated field.

## Rules

- Use lowercase kebab-case ASCII: `socket-head`, `gear-reducer`, `camera-module`.
- Keep at least one meaningful tag per part.
- Prefer tags that can apply to multiple parts.
- Do not duplicate `category`, `family`, `standard`, `aliases`, `id`, `name`, exact model/SKU values, dimensions, thread sizes, manufacturer names, or source/provenance.
- Put product/platform grouping in `family`, lookup abbreviations in `aliases`, factual scalar details in `attributes`, and standards in `standard`.

## Canonical Vocabulary

Use existing tags before creating new ones.

| Area | Good tags |
| --- | --- |
| Fasteners | `screw`, `socket-head`, `countersunk`, `button-head`, `threaded-rod`, `stud`, `nut`, `washer`, `flat`, `spring`, `large`, `tab`, `hex`, `nyloc`, `metric` |
| Bearings and pins | `bearing`, `ball-bearing`, `shielded`, `flanged`, `circlip`, `shaft`, `dowel`, `spring-pin` |
| Stock and profiles | `extrusion`, `t-slot`, `i-beam`, `steel`, `aluminum` |
| Electronics | `board`, `single-board-computer`, `sbc`, `compute-module`, `microcontroller`, `microcontroller-board`, `development-board`, `iot-board`, `industrial-board`, `sensor-board`, `headers`, `wireless`, `camera`, `camera-module`, `display`, `touchscreen`, `indicator`, `switch`, `relay`, `potentiometer`, `peripheral`, `audio`, `environmental-sensor`, `matter`, `connector`, `board-to-board`, `wire-to-board`, `pin-header`, `pin-socket`, `terminal-block`, `ffc-fpc`, `idc`, `card-connector`, `external-io`, `usb`, `d-sub`, `rj`, `rf`, `coaxial`, `power`, `barrel-jack`, `passive`, `resistor`, `capacitor`, `inductor`, `ferrite`, `diode`, `semiconductor`, `package`, `smd`, `through-hole`, `battery`, `holder` |
| Motion and power transmission | `servo`, `rc-servo`, `motor`, `robotic-actuator`, `frameless-torque-motor`, `gear-reducer`, `linear-motion`, `rail`, `carriage`, `lead-screw`, `pulley`, `timing-belt`, `belt`, `gear`, `rack`, `sprocket`, `chain`, `hub`, `coupler`, `can`, `robot-hand`, `gripper` |
| Thermal and airflow | `fan`, `heatsink`, `heat-transfer`, `thermal-interface`, `thermoelectric`, `airflow` |
| Controls and industrial | `industrial-control`, `machine-control`, `micro-plc` |
| Mechanical features | `standoff`, `flexible`, `accessory`, `bracket`, `boss`, `hinge`, `latch`, `handle`, `knob`, `plunger`, `wheel`, `damper`, `clutch`, `brake`, `key`, `isolator`, `bumper`, `grommet`, `panel`, `sheet`, `vent`, `case`, `module`, `radio-module`, `wide-fov`, `3d-printer` |

## Review Checklist

- Category, family, and standard filters still carry their own metadata.
- The tag would still make sense on another part.
- The tag is not just a model number, SKU, brand, dimension, thread, or source note.
- Search-only abbreviations are in `aliases`, not `tags`.
- New tags are worth adding to the canonical vocabulary above.
