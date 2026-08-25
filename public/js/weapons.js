/** SKULLBOND arsenal — homage stats tuned against the GE decomp meta. Shared by viewmodel/HUD/offline sim. */
export const WEAPONS = {
  pp7: {
    name: 'PP7 RAY',
    dmg: 40,
    cd: 200,
    mag: -1,
    reloadMs: 0,
    spread: 0,
    auto: true,
    recoil: 0.006,
    range: 70,
    tracer: 0x9dff9a,
    boltColor: 0x6baf6e,
    boltSize: 0.16,
    sound: 'pistol',
  },
  klobber: {
    name: 'KLOBBER',
    dmg: 24,
    cd: 120,
    mag: 70,
    reloadMs: 1400,
    spread: 0.03,
    auto: true,
    recoil: 0.004,
    range: 60,
    tracer: 0xfff2b3,
    boltColor: 0xfff2b3,
    boltSize: 0.11,
    sound: 'klobber',
  },
  dd: {
    name: 'DD SKULL',
    dmg: 72,
    cd: 470,
    mag: 21,
    reloadMs: 1600,
    spread: 0.006,
    auto: false,
    recoil: 0.022,
    range: 80,
    tracer: 0xff8a5c,
    boltColor: 0xff6a3d,
    boltSize: 0.2,
    sound: 'magnum',
  },
  kf7: {
    name: 'KF7 SKULLETV',
    dmg: 36,
    cd: 150,
    mag: 90,
    reloadMs: 2000,
    spread: 0.016,
    auto: true,
    recoil: 0.01,
    range: 75,
    tracer: 0xffe066,
    boltColor: 0xffd24a,
    boltSize: 0.14,
    sound: 'rifle',
  },
  gold: {
    name: 'GOLDEN SKULLGUN',
    dmg: 250,
    cd: 850,
    mag: 5,
    reloadMs: 0,
    spread: 0,
    auto: false,
    recoil: 0.05,
    range: 99,
    tracer: 0xffd700,
    boltColor: 0xffd700,
    boltSize: 0.26,
    sound: 'gold',
    oneShot: true,
  },
};

export const GOLD_SHOTS = 5;

/** Bot pickup preference — never downgrade. */
export const GUN_RANK = { gold: 9, kf7: 3, dd: 2, pp7: 1, klobber: 0 };

export function getWeapon(id) {
  return WEAPONS[id] || WEAPONS.pp7;
}
