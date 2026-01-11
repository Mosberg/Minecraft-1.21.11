# Minecraft Model Schemas

Specific JSON schemas for different types of block and item models in Minecraft 1.21.11.

## Block Model Schemas

### Basic Cube Models

- **cube_all.schema.json** - All sides same texture (e.g., stone, planks)
- **cube.schema.json** - Different texture per side
- **cube_column.schema.json** - Logs/pillars with end and side textures
- **cube_bottom_top.schema.json** - Distinct bottom, top, and side textures

### Structural Block Models

- **stairs.schema.json** - Stair blocks (stairs, inner_stairs, outer_stairs)
- **slab.schema.json** - Half-height slabs
- **fence.schema.json** - Fence posts and connections
- **fence_gate.schema.json** - Fence gates (closed, open, wall variants)
- **door.schema.json** - Door halves and hinge positions
- **trapdoor.schema.json** - Trapdoors (top, bottom, open)
- **button.schema.json** - Buttons (unpressed, pressed, inventory)
- **pressure_plate.schema.json** - Pressure plates (up, down)

### Decorative Block Models

- **cross.schema.json** - X-shaped plant models (flowers, saplings)

## Item Model Schemas

- **generated.schema.json** - 2D generated items with layers (most items)
- **handheld.schema.json** - Tools and weapons with specific holding angles
- **block_item.schema.json** - Items that reference block models

## Usage in VS Code

Add to `.vscode/settings.json`:

```json
{
  "json.schemas": [
    {
      "fileMatch": ["**/models/block/*_button*.json"],
      "url": "./schemas/models/block/button.schema.json"
    },
    {
      "fileMatch": ["**/models/block/*_door*.json"],
      "url": "./schemas/models/block/door.schema.json"
    },
    {
      "fileMatch": ["**/models/block/*_fence_gate*.json"],
      "url": "./schemas/models/block/fence_gate.schema.json"
    },
    {
      "fileMatch": [
        "**/models/block/*_fence*.json",
        "!**/models/block/*_fence_gate*.json"
      ],
      "url": "./schemas/models/block/fence.schema.json"
    },
    {
      "fileMatch": ["**/models/block/*_pressure_plate*.json"],
      "url": "./schemas/models/block/pressure_plate.schema.json"
    },
    {
      "fileMatch": ["**/models/block/*_slab*.json"],
      "url": "./schemas/models/block/slab.schema.json"
    },
    {
      "fileMatch": ["**/models/block/*_stairs*.json"],
      "url": "./schemas/models/block/stairs.schema.json"
    },
    {
      "fileMatch": ["**/models/block/*_trapdoor*.json"],
      "url": "./schemas/models/block/trapdoor.schema.json"
    },
    {
      "fileMatch": [
        "**/models/block/cross.json",
        "**/models/block/*_cross.json"
      ],
      "url": "./schemas/models/block/cross.schema.json"
    },
    {
      "fileMatch": [
        "**/models/item/handheld*.json",
        "**/models/item/*_sword.json",
        "**/models/item/*_axe.json",
        "**/models/item/*_pickaxe.json",
        "**/models/item/*_shovel.json",
        "**/models/item/*_hoe.json"
      ],
      "url": "./schemas/models/item/handheld.schema.json"
    },
    {
      "fileMatch": ["**/models/item/generated.json"],
      "url": "./schemas/models/item/generated.schema.json"
    }
  ]
}
```

## Pattern Matching

Schemas are matched to files based on patterns:

- **Button models**: Any file with `*_button*.json` in `models/block/`
- **Door models**: Any file with `*_door*.json`
- **Fence models**: Any file with `*_fence*.json` (excluding fence gates)
- **Fence gate models**: Any file with `*_fence_gate*.json`
- **Slab models**: Any file with `*_slab*.json`
- **Stairs models**: Any file with `*_stairs*.json`
- **Trapdoor models**: Any file with `*_trapdoor*.json`
- **Handheld items**: Tools (_\_sword, _\_axe, \*\_pickaxe, etc.)
- **Generated items**: Most other items

## Benefits

- Type-safe model definitions
- Autocomplete for texture variables
- Validation of parent model paths
- Documentation for required properties
- Quick reference for model patterns
