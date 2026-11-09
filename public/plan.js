const reserved = {
  viernes: [2,3,4,9,10,15,21,28,73,80,82],
  sabado: [2,9,12,17,19,27,49,73,82,83,84]
};

export function floorPlan(night) {
  const red = night === 'viernes' ? 'super-vip' : 'vip';
  const blue = night === 'viernes' ? 'vip' : 'terraza';
  const tables = [];
  function row(first, count, x, y, zone) {
    for (let i = 0; i < count; i++) {
      const number = first + i;
      const base = reserved[night].includes(number) ? 'reserved' : 'available';
      tables.push({number, x:x + i, y, zone, base});
    }
  }
  for (let i = 0; i < 4; i++) row(1 + 6*i, 6, 5, 3+i, 'primeras-filas');
  row(25, 6, 5, 8, blue);
  row(31, 5, 6, 9, blue);
  row(36, 5, 6, 10, blue);
  row(41, 4, 7, 11, blue);
  row(45, 4, 7, 12, blue);
  row(49, 7, 5, 14, red);
  row(56, 8, 4, 15, red);
  for (let i = 0; i < 7; i++) row(64 + 2*i, 2, 2, 2+i, red);
  row(78, 1, 2, 9, red);
  for (let i = 0; i < 6; i++) row(79+i, 1, 13, 2+i, 'camarote');
  return tables;
}

export const statusLabels = {available:'Disponible',reserved:'Reservada',blocked:'Bloqueada'};
