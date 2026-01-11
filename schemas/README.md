# Minecraft 1.21.11 Resource Pack JSON Schemas

This directory contains JSON schema files for validating and providing autocomplete for all JSON formats used in Minecraft 1.21.11 resource packs.

## Schema Files

### Core Schemas

- **pack.mcmeta.schema.json** - Resource pack metadata (pack.mcmeta)
- **blockstate.schema.json** - Block state definitions (assets/minecraft/blockstates/)
- **model.schema.json** - Block and item models (assets/minecraft/models/)
- **sounds.schema.json** - Sound event definitions (assets/minecraft/sounds.json)
- **atlas.schema.json** - Texture atlas configurations (assets/minecraft/atlases/)
- **particle.schema.json** - Particle definitions (assets/minecraft/particles/)
- **language.schema.json** - Language/localization files (assets/minecraft/lang/)
- **post_effect.schema.json** - Post-processing effects (assets/minecraft/post_effect/)
- **regional_compliancies.schema.json** - Regional compliance messages

## Usage

### VS Code

Add to your workspace or user settings (`.vscode/settings.json`):

```json
{
  "json.schemas": [
    {
      "fileMatch": ["**/pack.mcmeta"],
      "url": "./schemas/pack.mcmeta.schema.json"
    },
    {
      "fileMatch": ["**/blockstates/*.json"],
      "url": "./schemas/blockstate.schema.json"
    },
    {
      "fileMatch": ["**/models/**/*.json"],
      "url": "./schemas/model.schema.json"
    },
    {
      "fileMatch": ["**/sounds.json"],
      "url": "./schemas/sounds.schema.json"
    },
    {
      "fileMatch": ["**/atlases/*.json"],
      "url": "./schemas/atlas.schema.json"
    },
    {
      "fileMatch": ["**/particles/*.json"],
      "url": "./schemas/particle.schema.json"
    },
    {
      "fileMatch": ["**/lang/*.json"],
      "url": "./schemas/language.schema.json"
    },
    {
      "fileMatch": ["**/post_effect/*.json"],
      "url": "./schemas/post_effect.schema.json"
    },
    {
      "fileMatch": ["**/regional_compliancies.json"],
      "url": "./schemas/regional_compliancies.schema.json"
    }
  ]
}
```

### IntelliJ IDEA / WebStorm

1. Go to Settings → Languages & Frameworks → Schemas and DTDs → JSON Schema Mappings
2. Add each schema file and map to the appropriate file pattern

### Other Editors

Most modern editors with JSON support can use these schemas. Refer to your editor's documentation for schema configuration.

## Benefits

- **Autocomplete**: Get intelligent suggestions for properties and values
- **Validation**: Real-time error detection for invalid JSON structures
- **Documentation**: Hover over properties to see descriptions
- **Type Safety**: Ensure correct data types for all properties

## Minecraft Version

These schemas are specifically designed for **Minecraft Java Edition 1.21.11** (resource pack format 75).

## Note on Fabric Mods

This is a **resource pack** project, not a Fabric mod. Resource packs only contain assets (textures, models, sounds, etc.) and do not include Java code or Fabric-specific configurations.

For Fabric mod development, you would need different schema files covering:

- fabric.mod.json
- Mixin configurations
- Access widener files
- Data pack JSON formats (recipes, loot tables, advancements, etc.)

If you need Fabric mod schemas, please indicate which specific mod aspects you're working on.
