import type { GameSave } from "./map-types";
import type { MapGenerationOutput } from "./map-engine";

/** Refuse rather than remap opaque node references and silently lose progress. */
export function assertRecoveryMapCompatible(oldMap: MapGenerationOutput, next: MapGenerationOutput, saves: readonly GameSave[]): void {
  const nodes = (map: MapGenerationOutput) => new Map([
    ...map.l1Nodes.map(node => [node.id, `l1:${node.nameCn}`] as const),
    ...map.l2Nodes.map((node, i) => [`l2_${i}`, `l2:${node.regionIdx}:${node.name}`] as const),
    ...map.l3Nodes.map((node, i) => [`l3_${i}`, `l3:${node.regionIdx}:${node.name}`] as const),
  ]);
  const before = nodes(oldMap), after = nodes(next);
  for (const save of saves) {
    const refs = [save.currentNodeId, ...(save.discoveredNodes || []), ...(save.visitedNodes || []), ...Object.keys(save.searchedNodes || {}), ...save.agents.flatMap(agent => [agent.currentNodeId, ...agent.discoveredNodes, ...agent.visitedNodes])];
    for (const id of refs) {
      if (!before.has(id) || before.get(id) !== after.get(id)) throw new Error(`旧存档 ${save.id} 的地点 ${id} 无法无损匹配，已停止恢复并保留原存档`);
    }
  }
}
