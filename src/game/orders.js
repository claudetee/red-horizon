// RED HORIZON — the order pipeline. Every player action that mutates the
// simulation is encoded as a small serializable order and applied through
// this single code path. Single-player applies immediately; lockstep
// multiplayer queues orders into turns and both peers apply them on the
// same tick — which is why NOTHING in here may read local-only UI state
// (selection, camera, hover). Orders carry everything they need.
//
// Order shape: { k: kind, p: player, u: [unitIds], b: buildingId, t: targetId,
//                x, y, key, cells, crew } — all fields optional per kind.

export function applyOrder(g, o) {
  const own = e => e && e.hp > 0 && !e.dead && e.owner === o.p;
  const units = (o.u || []).map(id => g.byId.get(id)).filter(e => own(e) && !e.isBuilding);
  const bld = o.b != null ? g.byId.get(o.b) : null;
  const tgt = o.t != null ? g.byId.get(o.t) : null;

  switch (o.k) {
    // ---- unit movement / combat ----
    case 'mv': if (units.length) g.cmdMove(units, o.x, o.y); break;
    case 'am': if (units.length) g.cmdAttackMove(units, o.x, o.y); break;
    case 'atk': if (units.length && tgt && tgt.hp > 0 && !tgt.dead) g.cmdAttack(units, tgt); break;
    case 'stop': g.cmdStop(units); break;
    case 'guard': g.cmdGuard(units); break;
    case 'harv': g.cmdHarvest(units.filter(u => u.harv), o.x, o.y); break;
    case 'harvAuto':
      for (const u of units) {
        if (!u.harv) continue;
        const c = g.map.findOreNear((u.x / 32) | 0, (u.y / 32) | 0);
        if (c) u.orderHarvest(g, c.cx, c.cy);
      }
      break;
    case 'skill': for (const u of units) if (u.d.skill) u.useSkill(g); break;
    case 'unload': for (const u of units) if (u.d.crewed || u.d.transport) u.unloadAll(g); break;
    case 'board': {
      if (!tgt || tgt.isBuilding || tgt.hp <= 0) break;
      let n = 0;
      for (const u of units) if (u.d.organic && u.orderBoard(g, tgt, n > 0)) n++;
      break;
    }
    case 'crew': { // engineers -> construction site / damaged building
      if (!tgt || !tgt.isBuilding || tgt.owner !== o.p) break;
      let first = true;
      for (const u of units) if (u.d.builder) { u.orderBuild(g, tgt, !first); first = false; }
      break;
    }

    // ---- production (per-building queues) ----
    case 'buildU': if (bld && own(bld) && bld.enqueue) bld.enqueue(g, o.key); break;
    case 'cancelU': if (bld && own(bld)) bld.cancelQueued(g, o.key); break;
    case 'rally': if (bld && own(bld)) bld.rally = { x: o.x, y: o.y }; break;

    // ---- construction ----
    case 'place': g.applyPlacement(o.p, o.key, o.x, o.y, o.crew || []); break;
    case 'wall': g.applyWallLine(o.p, o.cells || [], o.crew || []); break;
    case 'sell': if (bld && own(bld)) bld.startSell(g); break;
    case 'repairB': if (bld && own(bld) && bld.state === 'active') bld.repairing = !bld.repairing; break;

    // ---- strategic ----
    case 'nuke': if (bld && own(bld) && bld.d.superweapon) g.launchNuke(bld, o.x, o.y); break;
    case 'gg': g.surrender(o.p); break;
  }
}
