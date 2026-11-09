export function whatsappForReservation(order, customer, {year, description}) {
  const online = order.channel === 'online';
  const lines = [
    'Hola, equipo de TRIP Cochabamba. Registré una solicitud de lounge desde la página y quisiera coordinar mi reserva.',
    '',
    '*DATOS DEL TITULAR*',
    '• Nombre: ' + customer.name,
    '• Apellido: ' + customer.surname,
    '• Cédula de identidad (CI): ' + customer.ci,
    '',
    '*DATOS DE LA RESERVA*',
    '• Evento: ' + order.event,
    '• Fecha: ' + order.date + ' de ' + year,
    '• Mesa: N.º ' + order.lounge,
    '• Zona: ' + order.zone,
    '• Importe del lounge: ' + order.amount + ' Bs',
    '• Condiciones de la zona: ' + description,
    '• Referencia web: ' + order.id.slice(0,8).toUpperCase(),
    '• Estado: ' + (online ? 'Pendiente de pago en la página.' : 'Solicitud registrada. La mesa se confirma al verificar el pago.'),
    '',
    online
      ? 'Completaré el pago desde mi reserva en la página. Por favor, indíquenme si hay alguna instrucción adicional para el ingreso. Gracias.'
      : '¿Podrían indicarme cómo confirmar esta mesa y completar el pago? Gracias.'
  ];
  return 'https://wa.me/59170785815?text=' + encodeURIComponent(lines.join('\n'));
}
