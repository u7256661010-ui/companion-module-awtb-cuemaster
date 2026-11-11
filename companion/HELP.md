## CueMaster

Controls the CueMaster jingle player (Advanced Works) and shows tile names, colours and remaining time on your buttons.

**Setup**

1. In CueMaster open *Settings → Stream Deck, Companion, OSC …* (at the bottom) and turn on *Companion and Stream Deck (HTTP and WebSocket)*. Default port 8088.
2. Companion on the same PC: host `127.0.0.1`. Companion on another computer: also enable *Reachable from the network* in CueMaster (it then shows the address to enter) and enter the CueMaster PC's IP address here.
3. Drag presets onto your buttons. *Active bank tiles* follow the bank you select in CueMaster, so one page serves all banks.

**Actions**: press tile, stop/fade a tile, select a tile in the player, select bank (A–E, next, previous), player stop/fade/pause/back to start/skip, stop all, panic, show end now.

**Feedbacks**: tile colour (and optionally name) from CueMaster, tile playing/paused/fading (blinks while playing), tile selected in player, bank active, tile pre-listened in edit mode (PFL, amber), CueMaster is in edit mode.

**Show and edit mode (CueMaster 1.1):** everything you trigger from Companion belongs to the show, whatever mode the PC is in. What the operator pre-listens on the PC in edit mode (PFL) never appears as "playing"; it has its own feedback, the variables `mode`, `pfl_name`, `pfl_cue`, `pfl_remaining` and the presets *Mode* and *PFL*.

**Variables**: `active_bank`, `active_bank_name`, `focus_name`, `focus_cue`, `focus_remaining`, `focus_elapsed`, `playing_count`, `mode`, `pfl_name`, `pfl_cue`, `pfl_remaining`, `current_<n>_name|state|remaining` for the tiles of the active bank, and `cue_<Bank>_<n>_name|state|remaining` for every tile (e.g. `cue_A_3_name`).

---

### Deutsch

In CueMaster unter *Einstellungen → Stream Deck, Companion, OSC …* (ganz unten) „Companion und Stream Deck“ einschalten (Port 8088). Läuft Companion auf einem anderen Rechner, dort zusätzlich „Aus dem Netzwerk erreichbar“ einschalten und hier die IP-Adresse des CueMaster-PCs eintragen. Danach die Vorlagen (Presets) auf die Tasten ziehen; „Active bank tiles“ folgen der in CueMaster gewählten Bank.

**Show und Edit-Modus (CueMaster 1.1):** Alles, was Companion auslöst, gehört zur Show, egal in welchem Modus der PC steht. Was am PC im Edit-Modus vorgehört wird (PFL), erscheint nie als „läuft“; dafür gibt es das Feedback „pre-listened in edit mode (PFL)“ (bernstein), die Variablen `mode`, `pfl_name`, `pfl_cue`, `pfl_remaining` und die Vorlagen „Mode“ und „PFL“.
