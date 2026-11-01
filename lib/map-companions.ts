import type { WorldSkeleton } from "./map-types";

type Companion = { id: string; name: string; aliases?: readonly string[] };
const normalize = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Only explicit names/aliases; never infer identities from personality text. */
export function removeCompanionNPCs(skeleton: WorldSkeleton, companions: readonly Companion[]): void {
  const ids = new Set(companions.map(character => character.id));
  const names = new Map<string, Set<string>>();
  for (const character of companions) {
    for (const name of [character.name, ...(character.aliases || [])].flatMap(value => value.split(/[／/|｜（）()]/))) {
      const key = normalize(name);
      if (!key) continue;
      const owners = names.get(key) || new Set<string>();
      owners.add(character.id); names.set(key, owners);
    }
  }
  const duplicate = (npc: { name: string; characterId?: string; independent?: boolean }) => {
    if (npc.independent === true) return false;
    if (npc.characterId) return ids.has(npc.characterId);
    if (!names.has(normalize(npc.name))) return false;
    // A name alone cannot distinguish a duplicate from an independent namesake.
    throw new Error(`同行身份有歧义：${npc.name}。请在完整原文中区分独立人物，或移除误生成的同行 NPC 后再恢复。`);
  };
  // Validate before mutating so an ambiguity never leaves a half-filtered skeleton.
  const all = [...skeleton.npcs, ...skeleton.richRegions.flatMap(region => [region.l1_npc, ...region.l2_nodes.map(node => node.npc), ...region.l3_nodes.map(node => node.npc)].filter((npc): npc is NonNullable<typeof npc> => !!npc))];
  all.forEach(duplicate);
  skeleton.npcs = skeleton.npcs.filter(npc => !duplicate(npc));
  for (const region of skeleton.richRegions) {
    if (region.l1_npc && duplicate(region.l1_npc)) region.l1_npc = undefined;
    for (const node of [...region.l2_nodes, ...region.l3_nodes]) if (node.npc && duplicate(node.npc)) node.npc = undefined;
  }
}
