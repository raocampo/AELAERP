-- Modo de conexión de la impresora térmica: 'ninguna' | 'red' | 'usb'.
--
-- El backend corre en la nube (Railway) y no puede alcanzar un puerto USB
-- del equipo del cliente — solo el navegador puede (WebUSB, Chrome/Edge/
-- Opera). Este campo permite que el frontend sepa si debe mandar los bytes
-- ESC/POS por TCP (modo 'red', ya existente) o por WebUSB (modo 'usb',
-- nuevo). Default 'ninguna': ningún tenant existente ve cambios.
ALTER TABLE "configuracion_sistema" ADD COLUMN "impresoraModo" VARCHAR(10) NOT NULL DEFAULT 'ninguna';
