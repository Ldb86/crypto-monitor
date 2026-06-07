//BR => production = node BR.js (04/06/2026) - remove 15m
//breakTriangle => prod = node breakTriangle.js (---) - fix notification -- offline
//bandaBellinger => prod_2 = node bandaBellinger.js (04/06/2026) - fix EMA5 when ther's real cross 
//maradona => staging = node (07/06/2026) -  change Dockerfile_



//BR.js = la rottura del rangeBox con TP/SL corretti
//breakoutRangeBox.js = come BR solo che ha un livello in meno
//bybit.js = primo codi per mandare notifiche su telegram basate su incroci MACD
//bandaBellinger.js = incrocio EMA5 + banda di Bollinger, manda notifica a chiusura candela(quando ci sta incrocio sul serio)
//EMA12.JS = incrocio EMA12 + banda di Bollinger > funzionanate
//triangleToCheck.js = incrocio EMA12 + banda di Bollinger + rottura del triangolo
//breakTriangle.js = rottura del triangolo, ma con check su BB e EMA12 solo nel messaggio
