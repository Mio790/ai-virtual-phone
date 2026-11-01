import type { WorldSkeleton } from "./map-types";

type Companion = { id: string; name: string; aliases?: readonly string[] };
const normalize = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export class CompanionIdentityError extends Error {
  constructor(public conflicts: { key: string; name: string; characterIds: string[] }[]) {
    super("同行身份有歧义：请确认同名人物身份；确认前不会保存任何数据");
  }
}

/** Only explicit names/aliases; never infer identities from personality text. */
export function removeCompanionNPCs(skeleton: WorldSkeleton, companions: readonly Companion[], decisions: Record<string, string> = {}): void {
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
  const all = [...skeleton.npcs, ...skeleton.richRegions.flatMap(region => [region.l1_npc, ...region.l2_nodes.map(node => node.npc), ...region.l3_nodes.map(node => node.npc)].filter((npc): npc is NonNullable<typeof npc> => !!npc))];
  const keys = new Map(all.map((npc, index) => [npc, String(index)]));
  const conflicts: { key: string; name: string; characterIds: string[] }[] = [];
  const duplicate = (npc: { name: string; characterId?: string; independent?: boolean }) => {
    if (npc.independent === true) return false;
    if (npc.characterId) return ids.has(npc.characterId);
    if (!names.has(normalize(npc.name))) return false;
    const key = keys.get(npc as typeof all[number])!;
    const candidates = [...names.get(normalize(npc.name))!];
    if (decisions[key] === "independent") return false;
    if (candidates.includes(decisions[key])) return true;
    conflicts.push({ key, name: npc.name, characterIds: candidates });
    return false;
  };
  // Validate before mutating so an ambiguity never leaves a half-filtered skeleton.
  all.forEach(duplicate);
  if (conflicts.length) throw new CompanionIdentityError(conflicts);
  skeleton.npcs = skeleton.npcs.filter(npc => !duplicate(npc));
  for (const region of skeleton.richRegions) {
    if (region.l1_npc && duplicate(region.l1_npc)) region.l1_npc = undefined;
    for (const node of [...region.l2_nodes, ...region.l3_nodes]) if (node.npc && duplicate(node.npc)) node.npc = undefined;
  }
}
