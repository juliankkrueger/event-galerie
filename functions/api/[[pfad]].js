// /api/status, /api/zugang, /api/manifest
// _daten.js erzeugt die Baukette (bau/bau.mjs) je Bau neu; im Repo liegt sie nicht.
import * as daten from "../_daten.js";
import { erzeugeHandler } from "../_lib/zugang.js";

export const onRequest = erzeugeHandler(daten);
