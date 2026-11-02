# Esquemas XSD de los comprobantes electrónicos 4.4

Son los esquemas oficiales del Ministerio de Hacienda de Costa Rica para la versión 4.4, en la revisión
que rige desde el 1 de noviembre de 2026: códigos de referencia 13 a 17, tipos de documento 19 y 20, y
la clave y las identificaciones alfanuméricas. Su espacio de nombres es
`https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/<tipo>`.

## De dónde salen

Hacienda los publica en `cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/`, pero ese servidor y
`hacienda.go.cr/docs` bloquean las descargas automáticas. Además, la copia de `hacienda.go.cr/docs`
(`FacturaElectronica_V4.4.xsd.xml` y similares, revisada el 2 de noviembre de 2026) es la revisión
anterior: la clave solo admite dígitos y no tiene los códigos nuevos.

Estos archivos vienen de dos proyectos independientes que los toman del CDN y los actualizaron en
octubre de 2026:

- [santydesignscr/factura-electronica](https://github.com/santydesignscr/factura-electronica) (MIT),
  `resources/xsd/v4.4/`: todos menos el recibo electrónico de pago.
- [BoltbitCR/API_Hacienda_Laravel](https://github.com/BoltbitCR/API_Hacienda_Laravel),
  `resources/xsd/v4.4/ReciboElectronicoPago_V4.4.xsd`: el recibo electrónico de pago.

Las dos copias son idénticas línea por línea en los siete esquemas que comparten. La única diferencia
es la ruta del `xs:import` de la firma, que acá apunta a `xmldsig-core-schema.xsd` en esta misma carpeta.
`xmldsig-core-schema.xsd` es el esquema de la firma XML del W3C.

## SHA-256

```
897e1afc3acdd4ec1eb1cad5da59159663a7146ef6453c0c9588279f11597d64  facturaElectronica.xsd
63d16863e3a7dd059662d52ab7762a13be247f2e419675206167123de44aa74d  facturaElectronicaCompra.xsd
704914c15b7864945127bad46f68c87a70494f8d5794b1502c41543110c1430a  facturaElectronicaExportacion.xsd
ac56ecaff9e491dcb5a214c6fa1d9e0ab3af452c2a6116b94ca87f7ae5771f52  mensajeReceptor.xsd
05a20c323275c7d8d83c13602fea5e84b9f4c3a3cb8a7193f1255604b2f9fc4b  notaCreditoElectronica.xsd
dc7cf3c1e9a7ef763490b9bfba630338dab1c67a0314d4c255e27691a3ebc12d  notaDebitoElectronica.xsd
403db58e3630e740677700731bda6b3932e6b1a756d9c3bab66bc77ce3f7a0b8  reciboElectronicoPago.xsd
fab202b32584a6fe92fae80291f6c058d4997a80421a515a301e089183d28300  tiqueteElectronico.xsd
d102ad3df7664c307e0c2c776ba4a90513b1969974d8a940bae1a77f9f21e15d  xmldsig-core-schema.xsd
```

Cuando Hacienda publique una revisión nueva, hay que reemplazar los archivos, actualizar esta lista y
correr `npm test`.
