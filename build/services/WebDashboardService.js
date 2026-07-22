"use strict";
// ============================================================
// GrowManager – WebDashboardService
// Interner HTTP-Server für das Live-Dashboard (Port 8097).
// Stellt JSON-Snapshot (/api/state) und SSE-Stream (/api/events) bereit.
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebDashboardService = void 0;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DEFAULT_STRAINS = [
    { id: 'strain-dante-inferno', name: 'Dante Inferno', type: 'hybrid', sativaPercent: 50, growWeeks: 4, bloomWeeks: 9, yieldGramsPerM2: 450, height: 'mittel', tempDayMin: 22, tempDayMax: 28, tempNightMin: 18, tempNightMax: 22, humidityVeg: 65, humidityBloom: 50, vpdMin: 0.8, vpdMax: 1.4, aroma: ['tropisch', 'zitrus', 'süß', 'exotisch'], effect: ['euphorisch', 'entspannend', 'kreativ'], thcPercent: 22, cbdPercent: 0.5, difficulty: 'mittel', breeder: 'Unbekannt', notes: 'Intensive tropische Aromen, gute Indoor-Performer.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-purple-punch', name: 'Purple Punch', type: 'indica', sativaPercent: 20, growWeeks: 4, bloomWeeks: 8, yieldGramsPerM2: 400, height: 'klein', tempDayMin: 20, tempDayMax: 26, tempNightMin: 17, tempNightMax: 21, humidityVeg: 60, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.3, aroma: ['traube', 'beere', 'süß', 'vanille'], effect: ['entspannend', 'schläfrig', 'glücklich'], thcPercent: 20, cbdPercent: 0.5, difficulty: 'einfach', breeder: 'Supernova Gardens', notes: 'Starke lila Färbung bei kühlen Nachttemperaturen (15-18°C). Kurze kompakte Pflanzen.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-seriousa', name: 'Seriousa', type: 'hybrid', sativaPercent: 40, growWeeks: 5, bloomWeeks: 9, yieldGramsPerM2: 500, height: 'groß', tempDayMin: 22, tempDayMax: 28, tempNightMin: 18, tempNightMax: 23, humidityVeg: 65, humidityBloom: 50, vpdMin: 0.8, vpdMax: 1.5, aroma: ['erdig', 'kiefern', 'würzig', 'holzig'], effect: ['entspannend', 'euphorisch', 'fokussiert'], thcPercent: 18, cbdPercent: 1.0, difficulty: 'mittel', breeder: 'Serious Seeds', notes: 'Robuste Sorte mit gutem Ertrag. Gute Resistenz gegen Schimmel und Schädlinge.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-og-kush', name: 'OG Kush', type: 'hybrid', sativaPercent: 45, growWeeks: 4, bloomWeeks: 8, yieldGramsPerM2: 400, height: 'mittel', tempDayMin: 21, tempDayMax: 27, tempNightMin: 17, tempNightMax: 21, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.4, aroma: ['erdig', 'kiefer', 'zitrus', 'kraftstoff'], effect: ['euphorisch', 'entspannend', 'glücklich'], thcPercent: 25, cbdPercent: 0.3, difficulty: 'mittel', breeder: 'Unknown', notes: 'Klassiker aus Kalifornien. Stressempfindlich – stabile Umgebungsbedingungen sind wichtig.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-girl-scout-cookies', name: 'Girl Scout Cookies', type: 'hybrid', sativaPercent: 40, growWeeks: 4, bloomWeeks: 9, yieldGramsPerM2: 450, height: 'mittel', tempDayMin: 21, tempDayMax: 27, tempNightMin: 18, tempNightMax: 22, humidityVeg: 60, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.4, aroma: ['süß', 'erdig', 'minze', 'schokolade'], effect: ['euphorisch', 'entspannend', 'kreativ'], thcPercent: 28, cbdPercent: 0.2, difficulty: 'mittel', breeder: 'Cookie Fam', notes: 'Extrem hoher THC-Gehalt. Reagiert gut auf Topping und Training (LST/SCROG).', createdAt: 0, updatedAt: 0 },
    { id: 'strain-blue-dream', name: 'Blue Dream', type: 'hybrid', sativaPercent: 70, growWeeks: 4, bloomWeeks: 9, yieldGramsPerM2: 500, height: 'groß', tempDayMin: 21, tempDayMax: 28, tempNightMin: 18, tempNightMax: 22, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.8, vpdMax: 1.4, aroma: ['heidelbeere', 'süß', 'vanille', 'erdig'], effect: ['entspannend', 'euphorisch', 'kreativ'], thcPercent: 21, cbdPercent: 0.1, difficulty: 'einfach', breeder: 'DJ Short', notes: 'Anfängerfreundlich, hohe Erträge. Kann sehr groß werden – Höhenkontrolle empfohlen.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-white-widow', name: 'White Widow', type: 'hybrid', sativaPercent: 50, growWeeks: 4, bloomWeeks: 8, yieldGramsPerM2: 450, height: 'mittel', tempDayMin: 20, tempDayMax: 26, tempNightMin: 17, tempNightMax: 21, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.4, aroma: ['erdig', 'würzig', 'holzig', 'scharf'], effect: ['euphorisch', 'kreativ', 'energetisch'], thcPercent: 20, cbdPercent: 0.2, difficulty: 'einfach', breeder: 'Green House Seeds', notes: 'Klassiker der 90er. Robust und widerstandsfähig gegen Schimmel. Ideal für Einsteiger.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-northern-lights', name: 'Northern Lights', type: 'indica', sativaPercent: 10, growWeeks: 4, bloomWeeks: 7, yieldGramsPerM2: 500, height: 'klein', tempDayMin: 20, tempDayMax: 26, tempNightMin: 16, tempNightMax: 20, humidityVeg: 60, humidityBloom: 40, vpdMin: 0.8, vpdMax: 1.3, aroma: ['süß', 'erdig', 'kiefer', 'würzig'], effect: ['entspannend', 'schläfrig', 'schmerzlindernd'], thcPercent: 18, cbdPercent: 0.2, difficulty: 'einfach', breeder: 'Sensi Seeds', notes: 'Indoor-Legende. Kurze Blütezeit, kompakter Wuchs. Ideal für kleine Räume.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-ak-47', name: 'AK-47', type: 'hybrid', sativaPercent: 65, growWeeks: 4, bloomWeeks: 8, yieldGramsPerM2: 400, height: 'mittel', tempDayMin: 21, tempDayMax: 27, tempNightMin: 18, tempNightMax: 22, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.4, aroma: ['erdig', 'würzig', 'blumig', 'sandelholz'], effect: ['entspannend', 'euphorisch', 'kreativ'], thcPercent: 20, cbdPercent: 0.2, difficulty: 'mittel', breeder: 'Serious Seeds', notes: 'Trotz des Namens sanfte, langanhaltende Wirkung. Mehrfach preisgekrönt.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-gorilla-glue-4', name: 'Gorilla Glue #4', type: 'hybrid', sativaPercent: 50, growWeeks: 4, bloomWeeks: 9, yieldGramsPerM2: 550, height: 'mittel', tempDayMin: 21, tempDayMax: 27, tempNightMin: 18, tempNightMax: 22, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.5, aroma: ['kraftstoff', 'erdig', 'kiefer', 'chemisch'], effect: ['entspannend', 'euphorisch', 'schläfrig'], thcPercent: 30, cbdPercent: 0.1, difficulty: 'mittel', breeder: 'GG Strains', notes: 'Extrem harzreich – Hände und Scheren kleben. Schwere, dichte Buds. Sehr hoher THC.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-gelato', name: 'Gelato', type: 'hybrid', sativaPercent: 45, growWeeks: 4, bloomWeeks: 8, yieldGramsPerM2: 450, height: 'mittel', tempDayMin: 21, tempDayMax: 27, tempNightMin: 18, tempNightMax: 22, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.4, aroma: ['süß', 'beere', 'orange', 'lavender'], effect: ['entspannend', 'euphorisch', 'kreativ'], thcPercent: 25, cbdPercent: 0.2, difficulty: 'mittel', breeder: 'Cookie Fam', notes: 'Intensiv süßes Aroma. Dichter, kompakter Wuchs. Reagiert gut auf Nährstoffe.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-zkittlez', name: 'Zkittlez', type: 'indica', sativaPercent: 30, growWeeks: 4, bloomWeeks: 8, yieldGramsPerM2: 450, height: 'klein', tempDayMin: 21, tempDayMax: 27, tempNightMin: 17, tempNightMax: 21, humidityVeg: 60, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.4, aroma: ['tropisch', 'süß', 'traube', 'beere'], effect: ['entspannend', 'glücklich', 'schmerzlindernd'], thcPercent: 23, cbdPercent: 0.5, difficulty: 'einfach', breeder: '3rd Gen Family', notes: 'Süßester Strain in der Wiki. Bunte Blätter in der Blüte. Preisgekrönt (2016 Emerald Cup).', createdAt: 0, updatedAt: 0 },
    { id: 'strain-wedding-cake', name: 'Wedding Cake', type: 'hybrid', sativaPercent: 40, growWeeks: 4, bloomWeeks: 8, yieldGramsPerM2: 500, height: 'mittel', tempDayMin: 21, tempDayMax: 27, tempNightMin: 18, tempNightMax: 22, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.4, aroma: ['süß', 'vanille', 'erdig', 'pfeffrig'], effect: ['entspannend', 'euphorisch', 'appetitanregend'], thcPercent: 27, cbdPercent: 0.3, difficulty: 'mittel', breeder: 'Seed Junky Genetics', notes: 'Auch bekannt als Pink Cookies. Dichte, harzige Buds. Hoher Ertrag, gutes Bag-Appeal.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-amnesia-haze', name: 'Amnesia Haze', type: 'sativa', sativaPercent: 80, growWeeks: 5, bloomWeeks: 11, yieldGramsPerM2: 600, height: 'groß', tempDayMin: 22, tempDayMax: 28, tempNightMin: 18, tempNightMax: 23, humidityVeg: 65, humidityBloom: 45, vpdMin: 1.0, vpdMax: 1.6, aroma: ['zitrus', 'erdig', 'würzig', 'blumig'], effect: ['euphorisch', 'kreativ', 'energetisch'], thcPercent: 21, cbdPercent: 0.2, difficulty: 'schwer', breeder: 'Soma Seeds', notes: 'Lange Blütezeit, aber außergewöhnliche Qualität. Coffeeshop-Klassiker aus Amsterdam.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-sour-diesel', name: 'Sour Diesel', type: 'sativa', sativaPercent: 90, growWeeks: 5, bloomWeeks: 10, yieldGramsPerM2: 450, height: 'groß', tempDayMin: 22, tempDayMax: 28, tempNightMin: 18, tempNightMax: 23, humidityVeg: 65, humidityBloom: 45, vpdMin: 1.0, vpdMax: 1.6, aroma: ['kraftstoff', 'zitrus', 'chemisch', 'scharf'], effect: ['energetisch', 'euphorisch', 'fokussiert'], thcPercent: 26, cbdPercent: 0.2, difficulty: 'schwer', breeder: 'Unknown (NY)', notes: 'Starkes, charakteristisches Diesel-Aroma. Langer Wuchs – Höhenkontrolle notwendig.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-jack-herer', name: 'Jack Herer', type: 'hybrid', sativaPercent: 75, growWeeks: 4, bloomWeeks: 10, yieldGramsPerM2: 450, height: 'groß', tempDayMin: 21, tempDayMax: 27, tempNightMin: 18, tempNightMax: 22, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.5, aroma: ['kiefer', 'erdig', 'würzig', 'holzig'], effect: ['euphorisch', 'kreativ', 'energetisch'], thcPercent: 18, cbdPercent: 0.3, difficulty: 'mittel', breeder: 'Sensi Seeds', notes: 'Benannt nach dem Cannabis-Aktivisten. Mehrfacher Cannabis Cup Gewinner. Klassiker.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-pineapple-express', name: 'Pineapple Express', type: 'hybrid', sativaPercent: 60, growWeeks: 4, bloomWeeks: 8, yieldGramsPerM2: 450, height: 'mittel', tempDayMin: 21, tempDayMax: 27, tempNightMin: 18, tempNightMax: 22, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.4, aroma: ['ananas', 'tropisch', 'zeder', 'erdig'], effect: ['euphorisch', 'kreativ', 'entspannend'], thcPercent: 25, cbdPercent: 0.1, difficulty: 'einfach', breeder: 'G13 Labs', notes: 'Durch den gleichnamigen Film weltberühmt. Fruchtige, tropische Aromen. Anfängerfreundlich.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-bubba-kush', name: 'Bubba Kush', type: 'indica', sativaPercent: 10, growWeeks: 4, bloomWeeks: 8, yieldGramsPerM2: 400, height: 'klein', tempDayMin: 20, tempDayMax: 26, tempNightMin: 16, tempNightMax: 20, humidityVeg: 60, humidityBloom: 40, vpdMin: 0.8, vpdMax: 1.3, aroma: ['schokolade', 'kaffee', 'erdig', 'würzig'], effect: ['entspannend', 'schläfrig', 'schmerzlindernd'], thcPercent: 22, cbdPercent: 0.2, difficulty: 'einfach', breeder: 'Unbekannt (USA)', notes: 'Schweres Body-High, ideal zum Einschlafen. Kompakter Wuchs, einfach zu handhaben.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-critical-mass', name: 'Critical Mass', type: 'indica', sativaPercent: 20, growWeeks: 4, bloomWeeks: 7, yieldGramsPerM2: 650, height: 'mittel', tempDayMin: 20, tempDayMax: 26, tempNightMin: 17, tempNightMax: 21, humidityVeg: 60, humidityBloom: 40, vpdMin: 0.8, vpdMax: 1.3, aroma: ['süß', 'erdig', 'würzig', 'fruchtig'], effect: ['entspannend', 'schmerzlindernd', 'schläfrig'], thcPercent: 18, cbdPercent: 0.3, difficulty: 'einfach', breeder: 'Mr. Nice Seeds', notes: 'Extrem hohe Erträge – Äste können unter dem Gewicht brechen. Stützen empfohlen.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-super-silver-haze', name: 'Super Silver Haze', type: 'sativa', sativaPercent: 80, growWeeks: 5, bloomWeeks: 11, yieldGramsPerM2: 500, height: 'groß', tempDayMin: 22, tempDayMax: 28, tempNightMin: 18, tempNightMax: 23, humidityVeg: 65, humidityBloom: 45, vpdMin: 1.0, vpdMax: 1.6, aroma: ['zitrus', 'würzig', 'erdig', 'blumig'], effect: ['euphorisch', 'kreativ', 'energetisch'], thcPercent: 21, cbdPercent: 0.2, difficulty: 'schwer', breeder: 'Green House Seeds', notes: '3x Cannabis Cup Gewinner (1997-1999). Langstrecken-Grow für erfahrene Züchter.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-granddaddy-purple', name: 'Granddaddy Purple', type: 'indica', sativaPercent: 15, growWeeks: 4, bloomWeeks: 8, yieldGramsPerM2: 450, height: 'mittel', tempDayMin: 20, tempDayMax: 26, tempNightMin: 16, tempNightMax: 20, humidityVeg: 60, humidityBloom: 40, vpdMin: 0.8, vpdMax: 1.3, aroma: ['traube', 'beere', 'süß', 'lavendel'], effect: ['entspannend', 'schläfrig', 'schmerzlindernd'], thcPercent: 20, cbdPercent: 0.1, difficulty: 'einfach', breeder: 'Ken Estes', notes: 'Beeindruckende lila-blaue Blütenfarbe. Perfekt für abendliche Entspannung.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-strawberry-cough', name: 'Strawberry Cough', type: 'sativa', sativaPercent: 85, growWeeks: 5, bloomWeeks: 9, yieldGramsPerM2: 400, height: 'groß', tempDayMin: 21, tempDayMax: 27, tempNightMin: 18, tempNightMax: 22, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.5, aroma: ['erdbeere', 'beere', 'süß', 'blumig'], effect: ['euphorisch', 'kreativ', 'fokussiert'], thcPercent: 18, cbdPercent: 0.5, difficulty: 'mittel', breeder: 'Kyle Kushman', notes: 'Starkes Erdbeer-Aroma. Der Rauch kann Hustenreiz auslösen. Aufheiternde Tageswirkung.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-bruce-banner', name: 'Bruce Banner', type: 'hybrid', sativaPercent: 60, growWeeks: 4, bloomWeeks: 9, yieldGramsPerM2: 550, height: 'groß', tempDayMin: 21, tempDayMax: 27, tempNightMin: 18, tempNightMax: 22, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.5, aroma: ['süß', 'erdig', 'diesel', 'blumig'], effect: ['euphorisch', 'kreativ', 'entspannend'], thcPercent: 29, cbdPercent: 0.3, difficulty: 'mittel', breeder: 'Dark Horse Genetics', notes: 'Einer der stärksten Strains überhaupt. Benannt nach dem Alter Ego von Hulk. Hohe Erträge.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-runtz', name: 'Runtz', type: 'hybrid', sativaPercent: 50, growWeeks: 4, bloomWeeks: 8, yieldGramsPerM2: 450, height: 'mittel', tempDayMin: 21, tempDayMax: 27, tempNightMin: 18, tempNightMax: 22, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.4, aroma: ['süß', 'fruchtig', 'tropisch', 'zuckerwatte'], effect: ['euphorisch', 'entspannend', 'glücklich'], thcPercent: 29, cbdPercent: 0.3, difficulty: 'mittel', breeder: 'Cookies x Runtz', notes: 'Extrem süßes, fruchtiges Profil. Hohe Nachfrage und Bag-Appeal. Viral in den USA.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-mimosa', name: 'Mimosa', type: 'hybrid', sativaPercent: 70, growWeeks: 5, bloomWeeks: 9, yieldGramsPerM2: 500, height: 'groß', tempDayMin: 22, tempDayMax: 28, tempNightMin: 18, tempNightMax: 23, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.5, aroma: ['orange', 'zitrus', 'tropisch', 'fruchtig'], effect: ['euphorisch', 'energetisch', 'fokussiert'], thcPercent: 27, cbdPercent: 0.3, difficulty: 'mittel', breeder: 'Symbiotic Genetics', notes: 'Frühstückscocktail im Strain-Format. Helles Zitrus-Aroma. Ideal als Tagesbegleiter.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-do-si-dos', name: 'Do-Si-Dos', type: 'indica', sativaPercent: 30, growWeeks: 4, bloomWeeks: 8, yieldGramsPerM2: 450, height: 'klein', tempDayMin: 21, tempDayMax: 27, tempNightMin: 17, tempNightMax: 21, humidityVeg: 60, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.4, aroma: ['blumig', 'süß', 'erdig', 'minze'], effect: ['entspannend', 'euphorisch', 'schläfrig'], thcPercent: 28, cbdPercent: 0.1, difficulty: 'mittel', breeder: 'Archive Seed Bank', notes: 'OG Kush Breath x Face Off OG. Intense Body-Stone. Buds sehr harzreich und dicht.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-lemon-haze', name: 'Lemon Haze', type: 'sativa', sativaPercent: 80, growWeeks: 5, bloomWeeks: 9, yieldGramsPerM2: 500, height: 'groß', tempDayMin: 22, tempDayMax: 28, tempNightMin: 18, tempNightMax: 23, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.5, aroma: ['zitrone', 'zitrus', 'süß', 'frisch'], effect: ['energetisch', 'euphorisch', 'aufheiternd'], thcPercent: 20, cbdPercent: 0.3, difficulty: 'mittel', breeder: 'Unknown', notes: 'Intensives Zitronen-Aroma. Aufhellende Tageswirkung. Gut geeignet für Outdoor.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-chemdawg', name: 'Chemdawg', type: 'hybrid', sativaPercent: 55, growWeeks: 4, bloomWeeks: 9, yieldGramsPerM2: 400, height: 'mittel', tempDayMin: 21, tempDayMax: 27, tempNightMin: 18, tempNightMax: 22, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.4, aroma: ['kraftstoff', 'chemisch', 'erdig', 'scharf'], effect: ['euphorisch', 'entspannend', 'kreativ'], thcPercent: 26, cbdPercent: 0.1, difficulty: 'schwer', breeder: 'Unknown (Grateful Dead)', notes: 'Elternteil von OG Kush und Sour Diesel. Prägnantes Diesel-Aroma. Für erfahrene Grower.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-mac', name: 'MAC (Miracle Alien Cookies)', type: 'hybrid', sativaPercent: 50, growWeeks: 4, bloomWeeks: 9, yieldGramsPerM2: 500, height: 'mittel', tempDayMin: 21, tempDayMax: 27, tempNightMin: 18, tempNightMax: 22, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.4, aroma: ['blumig', 'orange', 'würzig', 'cremig'], effect: ['euphorisch', 'kreativ', 'entspannend'], thcPercent: 28, cbdPercent: 0.2, difficulty: 'schwer', breeder: 'Capulator', notes: 'Außergewöhnliche Harzproduktion. Blüten silbrig-weiß von Trichomen überzogen.', createdAt: 0, updatedAt: 0 },
    { id: 'strain-tropicana-cookies', name: 'Tropicana Cookies', type: 'hybrid', sativaPercent: 70, growWeeks: 5, bloomWeeks: 9, yieldGramsPerM2: 500, height: 'groß', tempDayMin: 22, tempDayMax: 28, tempNightMin: 18, tempNightMax: 23, humidityVeg: 65, humidityBloom: 45, vpdMin: 0.9, vpdMax: 1.5, aroma: ['orange', 'zitrus', 'süß', 'tropisch'], effect: ['euphorisch', 'kreativ', 'aufheiternd'], thcPercent: 25, cbdPercent: 0.3, difficulty: 'mittel', breeder: 'Oni Seed Co', notes: 'Purple-Phäno zeigt lila Farben bei kühlen Nächten. Starkes Zitrusprofil mit Keks-Finish.', createdAt: 0, updatedAt: 0 },
];
class WebDashboardService {
    constructor(log, adapterDir) {
        this.log = log;
        this.adapterDir = adapterDir;
        this.server = null;
        this.sseClients = new Set();
        // Erlaubte Kamera-Origins (aus Adapter-Konfiguration) für SSRF-Schutz am cam-proxy
        this.allowedCameraOrigins = new Set();
        this.state = {
            ts: Date.now(),
            adapterVersion: '0.1.0',
            health: 'starting',
            activeAlarms: 0,
            groups: [],
        };
        this.dashboardHtml = '';
        this.pin = '';
        this.controlCallback = null;
        this.modeCallback = null;
        this.trendsCallback = null;
        this.databaseCallback = null;
        this.lifestyleGetCallback = null;
        this.lifestyleSetCallback = null;
        this.strainsGetCallback = null;
        this.strainsSetCallback = null;
        this.analysesGetCallback = null;
        this.analysesSetCallback = null;
        this.plantIdApiKey = '';
        this.strainsFilePath = '';
    }
    setPin(pin) { this.pin = pin; }
    setPlantIdApiKey(key) { this.plantIdApiKey = key; }
    setControlCallback(cb) { this.controlCallback = cb; }
    setModeCallback(cb) { this.modeCallback = cb; }
    setTrendsCallback(cb) { this.trendsCallback = cb; }
    setDatabaseCallback(cb) { this.databaseCallback = cb; }
    setLifestyleCallbacks(get, set) { this.lifestyleGetCallback = get; this.lifestyleSetCallback = set; }
    setStrainsCallbacks(get, set) { this.strainsGetCallback = get; this.strainsSetCallback = set; }
    setAnalysesCallbacks(get, set) { this.analysesGetCallback = get; this.analysesSetCallback = set; }
    start(port, bindAddress) {
        const htmlPath = path.join(this.adapterDir, 'admin', 'web', 'dashboard.html');
        this.strainsFilePath = path.join(this.adapterDir, 'strains.json');
        // Sorten laden (async, um ioBroker-State-Callback zu verwenden wenn gesetzt)
        this.loadStrains().catch(() => { });
        try {
            this.dashboardHtml = fs.readFileSync(htmlPath, 'utf-8');
        }
        catch {
            this.log.warn(`WebDashboard: HTML nicht gefunden unter ${htmlPath}`);
            this.dashboardHtml = '<html><body><p>dashboard.html nicht gefunden.</p></body></html>';
        }
        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res).catch(err => {
                this.log.error(`WebDashboard handleRequest: ${err}`);
                if (!res.headersSent) {
                    res.writeHead(500);
                    res.end();
                }
            });
        });
        this.server.on('error', err => this.log.error(`WebDashboard: ${err.message}`));
        this.server.listen(port, bindAddress, () => {
            this.log.info(`GrowManager Dashboard erreichbar unter http://${bindAddress}:${port}/`);
        });
    }
    async loadStrains() {
        let strains = [];
        // ioBroker-State bevorzugen
        if (this.strainsGetCallback) {
            try {
                const data = await this.strainsGetCallback();
                if (data.length > 0)
                    strains = data;
            }
            catch { /* ignore */ }
        }
        // Datei-Fallback wenn State leer
        if (strains.length === 0) {
            try {
                if (fs.existsSync(this.strainsFilePath)) {
                    const parsed = JSON.parse(fs.readFileSync(this.strainsFilePath, 'utf-8'));
                    if (Array.isArray(parsed) && parsed.length > 0)
                        strains = parsed;
                }
            }
            catch { /* ignore */ }
        }
        // Neue Default-Sorten mergen: fehlende IDs hinzufügen ohne bestehende zu überschreiben
        const existingIds = new Set(strains.map(s => s.id));
        const now = Date.now();
        let changed = strains.length === 0;
        for (const def of DEFAULT_STRAINS) {
            if (!existingIds.has(def.id)) {
                strains.push({ ...def, createdAt: now, updatedAt: now });
                changed = true;
            }
        }
        if (changed)
            await this.saveStrains(strains);
        return strains;
    }
    async saveStrains(strains) {
        // Callback bevorzugen (ioBroker-State)
        if (this.strainsSetCallback) {
            await this.strainsSetCallback(strains);
            return;
        }
        // Fallback: Datei
        try {
            fs.writeFileSync(this.strainsFilePath, JSON.stringify(strains, null, 2), 'utf-8');
        }
        catch (e) {
            this.log.error(`Strains speichern fehlgeschlagen: ${e}`);
        }
    }
    handleStrains(req, res, strainId) {
        const json = (data, status = 200) => {
            if (res.headersSent)
                return;
            res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(data));
        };
        if (!strainId) {
            // GET /api/strains
            if (req.method === 'GET') {
                this.loadStrains().then(strains => json(strains)).catch(e => json({ error: String(e) }, 500));
                return;
            }
            // POST /api/strains
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; if (body.length > 32768) {
                    if (!res.headersSent) {
                        res.writeHead(413);
                        res.end();
                    }
                    req.destroy();
                } });
                req.on('error', () => { });
                req.on('end', async () => {
                    try {
                        const strain = JSON.parse(body);
                        strain.id = `strain-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                        strain.createdAt = Date.now();
                        strain.updatedAt = Date.now();
                        const strains = await this.loadStrains();
                        strains.push(strain);
                        await this.saveStrains(strains);
                        json(strain, 201);
                    }
                    catch (e) {
                        json({ error: String(e) }, 400);
                    }
                });
                return;
            }
        }
        else {
            // GET /api/strains/:id, PUT /api/strains/:id, DELETE /api/strains/:id
            if (req.method === 'GET') {
                this.loadStrains().then(strains => {
                    const idx = strains.findIndex(s => s.id === strainId);
                    if (idx < 0) {
                        json({ error: 'Nicht gefunden' }, 404);
                        return;
                    }
                    json(strains[idx]);
                }).catch(e => json({ error: String(e) }, 500));
                return;
            }
            // PUT /api/strains/:id
            if (req.method === 'PUT') {
                let body = '';
                req.on('data', chunk => { body += chunk; if (body.length > 32768) {
                    if (!res.headersSent) {
                        res.writeHead(413);
                        res.end();
                    }
                    req.destroy();
                } });
                req.on('error', () => { });
                req.on('end', async () => {
                    try {
                        const strains = await this.loadStrains();
                        const idx = strains.findIndex(s => s.id === strainId);
                        const updated = JSON.parse(body);
                        updated.id = strainId;
                        updated.updatedAt = Date.now();
                        if (idx < 0) {
                            json({ error: 'Nicht gefunden' }, 404);
                            return;
                        }
                        strains[idx] = updated;
                        await this.saveStrains(strains);
                        json(updated);
                    }
                    catch (e) {
                        json({ error: String(e) }, 400);
                    }
                });
                return;
            }
            // DELETE /api/strains/:id
            if (req.method === 'DELETE') {
                this.loadStrains().then(async (strains) => {
                    const idx = strains.findIndex(s => s.id === strainId);
                    if (idx < 0) {
                        json({ error: 'Nicht gefunden' }, 404);
                        return;
                    }
                    strains.splice(idx, 1);
                    await this.saveStrains(strains);
                    json({ ok: true });
                }).catch(e => json({ error: String(e) }, 500));
                return;
            }
        }
        json({ error: 'Method not allowed' }, 405);
    }
    stop() {
        for (const client of this.sseClients) {
            try {
                client.end();
            }
            catch { /* ignore */ }
        }
        this.sseClients.clear();
        this.server?.close();
        this.server = null;
    }
    updateState(state) {
        this.state = state;
        // Kamera-Allowlist aus Gruppen-Konfiguration aktualisieren (SSRF-Schutz)
        this.allowedCameraOrigins.clear();
        for (const g of state.groups) {
            if (g.cameraUrl) {
                try {
                    this.allowedCameraOrigins.add(new URL(g.cameraUrl).origin);
                }
                catch { /* ungültige URL */ }
            }
        }
        if (this.sseClients.size > 0) {
            const data = `data: ${JSON.stringify(state)}\n\n`;
            for (const client of this.sseClients) {
                try {
                    client.write(data);
                }
                catch {
                    this.sseClients.delete(client);
                }
            }
        }
    }
    async handleRequest(req, res) {
        const url = (req.url ?? '/').split('?')[0];
        // CORS für lokale Entwicklung
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (url === '/' || url === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.dashboardHtml);
            return;
        }
        if (url === '/api/state') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(this.state));
            return;
        }
        if (url === '/api/events') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            res.write(`data: ${JSON.stringify(this.state)}\n\n`);
            this.sseClients.add(res);
            req.on('close', () => this.sseClients.delete(res));
            return;
        }
        if (url === '/api/control' && req.method === 'POST') {
            this.handleControl(req, res);
            return;
        }
        if (url === '/api/mode' && req.method === 'POST') {
            this.handleMode(req, res);
            return;
        }
        const trendMatch = url.match(/^\/api\/trends\/([^/]+)\/(temperature|humidity|vpd|soilMoisture|co2)$/);
        if (trendMatch) {
            const cb = this.trendsCallback;
            if (cb) {
                cb(trendMatch[1], trendMatch[2])
                    .then(data => {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify(data));
                })
                    .catch(err => {
                    this.log.error(`Trend-Abfrage fehlgeschlagen: ${err}`);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end('[]');
                });
            }
            else {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end('[]');
            }
            return;
        }
        const dbMatch = url.match(/^\/api\/database\/([^/]+)\/(stats|energy|irrigation)$/);
        if (dbMatch) {
            const cb = this.databaseCallback;
            const data = cb ? cb(dbMatch[1], dbMatch[2]) : [];
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(data));
            return;
        }
        const lsMatch = url.match(/^\/api\/lifestyle\/([^/]+)$/);
        if (lsMatch) {
            if (req.method === 'GET') {
                const cb = this.lifestyleGetCallback;
                if (cb) {
                    cb(lsMatch[1])
                        .then(data => {
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end(JSON.stringify(data ?? {}));
                    })
                        .catch(() => {
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end('{}');
                    });
                }
                else {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end('{}');
                }
                return;
            }
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; if (body.length > 4096) {
                    if (!res.headersSent) {
                        res.writeHead(413, { 'Content-Type': 'application/json' });
                        res.end('{"error":"too large"}');
                    }
                    req.destroy();
                } });
                req.on('error', () => { });
                req.on('end', async () => {
                    try {
                        const data = JSON.parse(body);
                        const cb = this.lifestyleSetCallback;
                        if (cb)
                            await cb(lsMatch[1], data);
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end('{"ok":true}');
                    }
                    catch (e) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: String(e) }));
                    }
                });
                return;
            }
        }
        if (url === '/api/plant-analysis' && req.method === 'POST') {
            this.handlePlantAnalysis(req, res);
            return;
        }
        // Sortenwiki API
        if (url === '/api/strains') {
            this.handleStrains(req, res);
            return;
        }
        const strainIdMatch = url.match(/^\/api\/strains\/([^/]+)$/);
        if (strainIdMatch) {
            this.handleStrains(req, res, strainIdMatch[1]);
            return;
        }
        // GET|PUT /api/analyses/:groupId
        const analysesMatch = url.match(/^\/api\/analyses\/([^/]+)$/);
        if (analysesMatch) {
            const groupId = analysesMatch[1];
            const jsonA = (data, status = 200) => {
                if (res.headersSent)
                    return;
                res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify(data));
            };
            if (req.method === 'GET') {
                try {
                    const list = this.analysesGetCallback ? await this.analysesGetCallback(groupId) : [];
                    jsonA(list);
                }
                catch (err) {
                    if (!res.headersSent) {
                        res.writeHead(500);
                        res.end('[]');
                    }
                }
                return;
            }
            if (req.method === 'PUT') {
                let body = '';
                req.on('data', chunk => { body += chunk; if (body.length > 524288) {
                    if (!res.headersSent) {
                        res.writeHead(413);
                        res.end();
                    }
                    req.destroy();
                } });
                req.on('error', () => { });
                req.on('end', async () => {
                    try {
                        const analyses = JSON.parse(body);
                        if (this.analysesSetCallback)
                            await this.analysesSetCallback(groupId, analyses);
                        jsonA({ ok: true });
                    }
                    catch (e) {
                        jsonA({ error: String(e) }, 400);
                    }
                });
                return;
            }
        }
        // Camera proxy: fetches image from local camera URL server-side, avoids browser CORS
        if (url === '/api/cam-proxy' && req.method === 'GET') {
            const rawUrl = new URL(req.url ?? '/', `http://localhost`).searchParams.get('url');
            if (!rawUrl) {
                res.writeHead(400);
                res.end('Missing url param');
                return;
            }
            try {
                const camUrl = new URL(decodeURIComponent(rawUrl));
                // SSRF-Schutz: nur http/https und nur konfigurierte Kamera-Origins erlauben
                if (camUrl.protocol !== 'http:' && camUrl.protocol !== 'https:') {
                    res.writeHead(400);
                    res.end('Bad protocol');
                    return;
                }
                if (this.allowedCameraOrigins.size === 0 || !this.allowedCameraOrigins.has(camUrl.origin)) {
                    res.writeHead(403);
                    res.end('URL not in camera allowlist');
                    return;
                }
                const lib = camUrl.protocol === 'https:' ? https : http;
                const proxyReq = lib.get(camUrl.toString(), proxyRes => {
                    if (res.headersSent) {
                        proxyRes.resume();
                        return;
                    }
                    const ct = proxyRes.headers['content-type'] ?? 'image/jpeg';
                    res.writeHead(proxyRes.statusCode ?? 200, {
                        'Content-Type': ct,
                        'Cache-Control': 'no-store',
                        'Access-Control-Allow-Origin': '*',
                    });
                    proxyRes.pipe(res);
                    proxyRes.on('error', () => { if (!res.writableEnded)
                        res.end(); });
                });
                proxyReq.setTimeout(8000, () => {
                    proxyReq.destroy();
                    if (!res.headersSent) {
                        res.writeHead(504);
                        res.end();
                    }
                    else if (!res.writableEnded) {
                        res.end();
                    }
                });
                proxyReq.on('error', () => {
                    if (!res.headersSent) {
                        res.writeHead(502);
                        res.end();
                    }
                    else if (!res.writableEnded) {
                        res.end();
                    }
                });
            }
            catch {
                res.writeHead(400);
                res.end('Invalid url');
            }
            return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
    handlePlantAnalysis(req, res) {
        if (!this.plantIdApiKey) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Kein Plant.id API-Key konfiguriert. Bitte in den globalen Einstellungen hinterlegen.' }));
            return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 8 * 1024 * 1024) {
            if (!res.headersSent) {
                res.writeHead(413);
                res.end();
            }
            req.destroy();
        } });
        req.on('error', () => { });
        req.on('end', () => {
            let imageBase64;
            try {
                const parsed = JSON.parse(body);
                if (!parsed.image)
                    throw new Error('Kein Bild');
                // Base64-Daten-URL bereinigen
                imageBase64 = parsed.image.replace(/^data:image\/[a-z]+;base64,/, '');
            }
            catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Ungültige Anfrage: ${e}` }));
                return;
            }
            const payload = JSON.stringify({
                images: [imageBase64],
                similar_images: true,
            });
            const options = {
                hostname: 'plant.id',
                path: '/api/v3/health_assessment',
                method: 'POST',
                headers: {
                    'Api-Key': this.plantIdApiKey,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
            };
            const plantReq = https.request(options, plantRes => {
                let data = '';
                plantRes.on('data', chunk => {
                    data += chunk;
                    if (data.length > 512 * 1024) { // 512 KB Limit für plant.id Antwort
                        plantReq.destroy();
                        if (!res.headersSent) {
                            res.writeHead(502, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Antwort von plant.id zu groß' }));
                        }
                    }
                });
                plantRes.on('error', () => {
                    if (!res.headersSent) {
                        res.writeHead(502, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Stream-Fehler von plant.id' }));
                    }
                });
                plantRes.on('end', () => {
                    if (res.headersSent)
                        return;
                    res.writeHead(plantRes.statusCode ?? 200, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    });
                    res.end(data);
                });
            });
            plantReq.setTimeout(10000, () => {
                plantReq.destroy(new Error('plant.id timeout'));
            });
            plantReq.on('error', err => {
                this.log.error(`Plant.id API Fehler: ${err.message}`);
                if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `Plant.id nicht erreichbar: ${err.message}` }));
                }
            });
            plantReq.write(payload);
            plantReq.end();
        });
    }
    handleMode(req, res) {
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 65536) {
            if (!res.headersSent) {
                res.writeHead(413);
                res.end();
            }
            req.destroy();
        } });
        req.on('error', () => { });
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);
                if (this.pin && payload.pin !== this.pin) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Falsche PIN' }));
                    return;
                }
                if (!this.modeCallback) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Adapter nicht bereit' }));
                    return;
                }
                if (!payload.groupId || !payload.mode) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'groupId und mode erforderlich' }));
                    return;
                }
                const VALID_MODES = ['off', 'manual', 'schedule', 'temperature', 'humidity', 'vpd', 'combined', 'monitorOnly', 'maintenance'];
                if (!VALID_MODES.includes(payload.mode)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Ungültiger Modus' }));
                    return;
                }
                await this.modeCallback({ groupId: payload.groupId, mode: payload.mode });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            }
            catch (e) {
                this.log.error(`WebDashboard Mode-Fehler: ${e}`);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: String(e) }));
            }
        });
    }
    handleControl(req, res) {
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 65536) {
            if (!res.headersSent) {
                res.writeHead(413);
                res.end();
            }
            req.destroy();
        } });
        req.on('error', () => { });
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);
                if (this.pin && payload.pin !== this.pin) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Falsche PIN' }));
                    return;
                }
                if (!this.controlCallback) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Adapter nicht bereit' }));
                    return;
                }
                if (!payload.groupId || !payload.actuatorId || payload.command === undefined || payload.command === null) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'groupId, actuatorId und command erforderlich' }));
                    return;
                }
                if (typeof payload.command !== 'boolean' && typeof payload.command !== 'number') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'command muss boolean oder number sein' }));
                    return;
                }
                await this.controlCallback({
                    groupId: payload.groupId,
                    actuatorId: payload.actuatorId,
                    command: payload.command,
                    durationMinutes: payload.durationMinutes ?? 60,
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            }
            catch (e) {
                this.log.error(`WebDashboard Control-Fehler: ${e}`);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: String(e) }));
            }
        });
    }
}
exports.WebDashboardService = WebDashboardService;
//# sourceMappingURL=WebDashboardService.js.map