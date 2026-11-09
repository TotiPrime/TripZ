const commonBirthday = ['Ingreso gratuito del cumpleañero', 'Lounge VIP', 'Dos botellas básicas', 'Invitación digital', 'Show especial a medianoche', 'Kit con banda, corona y vela'];
const fridayNote = 'En consumo. Entrada por separado.';
const saturdayNote = 'Incluye 5 manillas de ingreso y 1 combo (Singani o Ron 37 Lenguas).';
export const events = {
  viernes: {
    title: 'Festi Cumbia Vol. 1',
    date: 'Viernes 13 de noviembre',
    dateISO: '2026-11-13',
    map: 'plano-cumbia',
    note: 'Cupos por confirmar. El precio de los lounges se aplica al consumo. La entrada se compra por separado.',
    zones: [
      ['vip', 'VIP', 500, fridayNote, '#6fe3db'],
      ['super-vip', 'Súper VIP', 600, fridayNote, '#ff85c4'],
      ['camarote', 'Mezanine Camarote', 700, fridayNote, '#9aeca0'],
      ['primeras-filas', 'Primeras filas', 800, fridayNote, '#ffc76f']
    ],
    birthday: ['cumple', 'Paquete cumpleañero', 600, commonBirthday]
  },
  sabado: {
    title: 'Rodeó Fest',
    date: 'Sábado 14 de noviembre',
    dateISO: '2026-11-14',
    map: 'plano-rodeo',
    note: 'Cupos por confirmar. Para conocer disponibilidad de preventa y tiers, consulta al equipo de TRIP.',
    zones: [
      ['vip', 'VIP', 750, saturdayNote, '#6fe3db'],
      ['terraza', 'Súper VIP Terraza', 800, saturdayNote, '#ff85c4'],
      ['primeras-filas', 'Súper VIP Primeras filas', 900, saturdayNote, '#ffc76f'],
      ['camarote', 'Camarote', 950, saturdayNote, '#9aeca0']
    ],
    birthday: ['cumple', 'Paquete cumpleañero', 700, [...commonBirthday.slice(0, 1), '5 manillas de ingreso', ...commonBirthday.slice(1, 3), 'Ronda de shots para los invitados', ...commonBirthday.slice(3)]]
  }
};
