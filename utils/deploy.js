//crypto-monitor => production = node BR.js (4 mouths ago) - new message
//new crypto => prod = node breakTriangle.js (---) - fix notification
//upgrade_crypto => prod_2 = node bandaBellinger.js (2 mouths ago) - fix EMA5 when ther's real cross



//BR.js = la rottura del rangeBox con TP/SL corretti
//breakoutRangeBox.js = come BR solo che ha un livello in meno
//bybit.js = primo codi per mandare notifiche su telegram basate su incroci MACD
//bandaBellinger.js = incrocio EMA5 + banda di Bollinger, manda notifica a chiusura candela(quando ci sta incrocio sul serio)
//EMA12.JS = incrocio EMA12 + banda di Bollinger > funzionanate
//triangleToCheck.js = incrocio EMA12 + banda di Bollinger + rottura del triangolo
//breakTriangle.js = rottura del triangolo, ma con check su BB e EMA12 solo nel messaggio
