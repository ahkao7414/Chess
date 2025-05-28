// ai_player.js (或 game.min.js 內)
(function(GameGlobal, $) {
    "use strict";

    if (typeof GameGlobal.AIEngine === 'undefined') {
        GameGlobal.AIEngine = {};
    }

    // 1. 盤面評估相關函式
    // ==========================================
    GameGlobal.AIEngine.getPieceValue = function(pieceType) {
        switch (pieceType) {
            case "pawn": return 100; // 調整了基礎分值，讓整數計算更方便
            case "knight": return 320;
            case "bishop": return 330;
            case "rook": return 500;
            case "queen": return 900;
            case "king": return 20000; // 國王分值極高，代表其重要性
            default: return 0;
        }
    };

    /**
     * 評估當前棋盤局面分數。
     * @param {object} gameInstance - GameGlobal.Game 的實例。
     * @param {string} playerColor - AI 自己的顏色。
     * @returns {number} 對於 playerColor 而言的盤面分數。
     */
    GameGlobal.AIEngine.evaluateBoard = function(gameInstance, playerColor) {
        var score = 0;
        // 基本子力評估
        _.each(gameInstance.pieces, function(piece) {
            var pieceValue = GameGlobal.AIEngine.getPieceValue(piece.type);
            if (piece.color === playerColor) {
                score += pieceValue;
            } else {
                score -= pieceValue;
            }
        });

        // TODO: 未來可以加入更多評估因素：
        // - 棋子位置分 (例如，中央的馬，兵的位置等)
        // - 國王安全分
        // - 兵結構
        // - 控制的格子數量 (機動性)
        // - 是否將軍 (可以給一個額外獎勵/懲罰)

        return score;
    };


    // 2. Minimax 演算法核心
    // ==========================================
    var SEARCH_DEPTH = 2; // 起始搜索深度 (例如 AI走一步，人類走一步)
                          // 注意：深度增加會顯著增加計算時間！深度3可能已經很慢。

    /**
     * Minimax 遞迴函式。
     * @param {object} gameInstanceSim - 模擬的 GameGlobal.Game 實例。
     * @param {number} depth - 當前搜索深度。
     * @param {boolean} isMaximizingPlayer - 當前是否是 AI (最大化玩家) 在模擬中行棋。
     * @param {string} aiPlayerColor - AI 玩家的顏色。
     * @returns {number} 該節點的評估分數。
     */
    function minimax(gameInstanceSim, depth, isMaximizingPlayer, aiPlayerColor) {
        // 終止條件：達到最大深度或遊戲結束
        if (depth === 0 || gameInstanceSim.isFinished()) {
            // 如果遊戲因國王被吃而結束，評估函式需要能反映這一點
            if (gameInstanceSim.winner) {
                if (gameInstanceSim.winner === aiPlayerColor) return Infinity; // AI贏了，極大分
                else return -Infinity; // AI輸了，極小分
            }
            // 如果是平局或其他結束條件，可以返回0或特定的評估
            // 否則，返回當前盤面的靜態評估
            return GameGlobal.AIEngine.evaluateBoard(gameInstanceSim, aiPlayerColor);
        }

        var legalMoves = [];
        var playerForThisTurn = isMaximizingPlayer ? aiPlayerColor : (aiPlayerColor === "white" ? "black" : "white");
        var piecesForThisTurn = _.filter(gameInstanceSim.pieces, function(p) { return p.color === playerForThisTurn; });

        _.each(piecesForThisTurn, function(piece) {
            var moves = gameInstanceSim.getMoves(piece, gameInstanceSim.generateCurrentMap());
            _.each(moves, function(targetSquare) {
                legalMoves.push({ piece: piece, to: targetSquare, from: piece.position });
            });
        });

        if (legalMoves.length === 0) { // 沒有合法走法 (將死或逼和)
             if (gameInstanceSim.isCheck(playerForThisTurn)) { // 被將死
                return isMaximizingPlayer ? -Infinity : Infinity; // 如果是AI被將死，分數極小；如果是對手被AI將死，分數極大
            } else { // 逼和
                return 0;
            }
        }

        if (isMaximizingPlayer) { // AI (最大化玩家) 的回合
            var maxEval = -Infinity;
            for (var i = 0; i < legalMoves.length; i++) {
                var move = legalMoves[i];
                // 1. 創建一個新的遊戲狀態副本來模擬移動
                var childGameSim = new GameGlobal.Game(gameInstanceSim.export()); // 使用 export/import 創建副本
                var pieceToMoveInSim = childGameSim.findPieceByPosition(move.from); // 找到副本中的棋子

                if (!pieceToMoveInSim) {
                    console.error("[AI Minimax] Simulated piece not found at", move.from);
                    continue; // 跳過這個無效的模擬分支
                }
                childGameSim.currentPiece = pieceToMoveInSim; // 設置當前棋子以使用 move/take 方法
                childGameSim.possibleMoves = childGameSim.getMoves(pieceToMoveInSim, childGameSim.generateCurrentMap());


                var pieceAtTargetInSim = childGameSim.findPieceByPosition(move.to);
                if (pieceAtTargetInSim && pieceAtTargetInSim.color !== pieceToMoveInSim.color) { // 吃子
                    childGameSim.takeWithSelected(pieceAtTargetInSim);
                } else if (!pieceAtTargetInSim) { // 移動到空格
                    childGameSim.moveSelected(move.to);
                } else { // 不應該發生（移動到己方棋子格）
                    console.error("[AI Minimax] Invalid simulated move target by Maximizer");
                    continue;
                }
                
                // 兵升變處理 (AI 預設升變為皇后)
                var promoDetails = childGameSim.checkPawnPromotion(childGameSim.currentPiece);
                if (promoDetails.needsPromotion) {
                    childGameSim.pawnThatReachedEnd = promoDetails.pawn; // 設置這個才能finalize
                    childGameSim.finalizePawnPromotion("queen"); // AI 在模擬中自動升變皇后
                }
                childGameSim.currentPlayer = playerForThisTurn; // 確保currentPlayer正確 (雖然toggle後會改)
                childGameSim.toggleCurrentPlayer(); // 輪到最小化玩家


                var evalScore = minimax(childGameSim, depth - 1, false, aiPlayerColor);
                maxEval = Math.max(maxEval, evalScore);
            }
            return maxEval;
        } else { // 對手 (最小化玩家) 的回合
            var minEval = Infinity;
            for (var j = 0; j < legalMoves.length; j++) {
                var move = legalMoves[j];
                var childGameSim = new GameGlobal.Game(gameInstanceSim.export());
                var pieceToMoveInSim = childGameSim.findPieceByPosition(move.from);

                if (!pieceToMoveInSim) {
                     console.error("[AI Minimax] Simulated piece not found at", move.from);
                    continue;
                }
                childGameSim.currentPiece = pieceToMoveInSim;
                childGameSim.possibleMoves = childGameSim.getMoves(pieceToMoveInSim, childGameSim.generateCurrentMap());

                var pieceAtTargetInSim = childGameSim.findPieceByPosition(move.to);
                 if (pieceAtTargetInSim && pieceAtTargetInSim.color !== pieceToMoveInSim.color) {
                    childGameSim.takeWithSelected(pieceAtTargetInSim);
                } else if (!pieceAtTargetInSim) {
                    childGameSim.moveSelected(move.to);
                } else {
                    console.error("[AI Minimax] Invalid simulated move target by Minimizer");
                    continue;
                }

                var promoDetails = childGameSim.checkPawnPromotion(childGameSim.currentPiece);
                if (promoDetails.needsPromotion) {
                     childGameSim.pawnThatReachedEnd = promoDetails.pawn;
                    childGameSim.finalizePawnPromotion("queen"); // 對手在模擬中也預設升變皇后
                }
                childGameSim.currentPlayer = playerForThisTurn;
                childGameSim.toggleCurrentPlayer(); // 輪到最大化玩家

                var evalScore = minimax(childGameSim, depth - 1, true, aiPlayerColor);
                minEval = Math.min(minEval, evalScore);
            }
            return minEval;
        }
    }


    // 3. 修改 AIEngine.chooseMove 以使用 Minimax
    // ==================================================
    GameGlobal.AIEngine.chooseMove = function(gameInstance) {
        console.log("[AI] Choosing move for player:", gameInstance.currentPlayer, "using Minimax with depth", SEARCH_DEPTH);
        var aiColor = gameInstance.currentPlayer;
        var allMyPieces = _.filter(gameInstance.pieces, function(p) { return p.color === aiColor; });
        var possibleAIMoves = [];

        _.each(allMyPieces, function(piece) {
            var moves = gameInstance.getMoves(piece, gameInstance.generateCurrentMap());
            _.each(moves, function(targetSquare) {
                possibleAIMoves.push({
                    piece: piece,
                    from: piece.position,
                    to: targetSquare
                });
            });
        });

        if (possibleAIMoves.length === 0) {
            console.log("[AI] No possible moves found at top level.");
            return null;
        }

        var bestMove = null;
        var bestScore = -Infinity;

        console.log("[AI] Evaluating", possibleAIMoves.length, "possible top-level moves...");

        for (var k = 0; k < possibleAIMoves.length; k++) {
            var move = possibleAIMoves[k];
            
            var gameSim = new GameGlobal.Game(gameInstance.export()); // 創建副本用於模擬
            var pieceToMoveInSim = gameSim.findPieceByPosition(move.from);

            if (!pieceToMoveInSim) {
                 console.error("[AI chooseMove] Simulated piece not found at", move.from);
                continue;
            }
            
            gameSim.currentPiece = pieceToMoveInSim; // 設置當前棋子
            gameSim.possibleMoves = gameSim.getMoves(pieceToMoveInSim, gameSim.generateCurrentMap()); // 更新可能走法

            var pieceAtTargetInSim = gameSim.findPieceByPosition(move.to);
            var moveMadeSuccessfullyInSim = false;

            if (pieceAtTargetInSim && pieceAtTargetInSim.color !== pieceToMoveInSim.color) { // 吃子
                if (gameSim.canTakeWithSelected(pieceAtTargetInSim)) { // 檢查是否可吃
                    gameSim.takeWithSelected(pieceAtTargetInSim);
                    moveMadeSuccessfullyInSim = true;
                } else {
                     console.warn("[AI chooseMove] Simulated take was illegal for move:", move);
                }
            } else if (!pieceAtTargetInSim) { // 移動到空格
                 if (gameSim.canMoveSelected(move.to)) { // 檢查是否可移
                    gameSim.moveSelected(move.to);
                    moveMadeSuccessfullyInSim = true;
                } else {
                    console.warn("[AI chooseMove] Simulated move was illegal for move:", move);
                }
            } else { // 移動到己方棋子格 (不應該被 getMoves 允許)
                 console.warn("[AI chooseMove] Simulated move to own piece for move:", move);
            }

            if (!moveMadeSuccessfullyInSim) {
                continue; // 如果模擬移動失敗，跳過這個分支
            }

            // 兵升變處理 (AI 預設升變為皇后)
            var promoDetails = gameSim.checkPawnPromotion(gameSim.currentPiece);
            if (promoDetails.needsPromotion) {
                gameSim.pawnThatReachedEnd = promoDetails.pawn;
                gameSim.finalizePawnPromotion("queen"); 
            }
            gameSim.currentPlayer = aiColor; // 確保當前玩家是AI
            gameSim.toggleCurrentPlayer();   // 切換到對手回合，準備進行下一步Minimax評估

            // 呼叫Minimax，深度減1，並且輪到最小化玩家 (false)
            var currentMoveScore = minimax(gameSim, SEARCH_DEPTH - 1, false, aiColor); 
            console.log("[AI] Move:", move.from, "->", move.to, "Evaluated Score:", currentMoveScore);

            if (currentMoveScore > bestScore) {
                bestScore = currentMoveScore;
                bestMove = move;
            } else if (currentMoveScore === bestScore) {
                // 如果分數相同，可以加入一些隨機性，避免AI走法單調
                if (Math.random() < 0.3) { // 30% 的機率選擇這個同樣高分的棋步
                    bestMove = move;
                }
            }
        }
        
        if (!bestMove && possibleAIMoves.length > 0) { // 如果沒有找到最佳，或者所有都無效，隨機選一個
            console.warn("[AI] No best move determined by minimax, or all simulated moves failed. Picking random valid move.");
            bestMove = possibleAIMoves[Math.floor(Math.random() * possibleAIMoves.length)];
        }

        if (bestMove) {
            // 返回的 move 物件需要包含原始的 piece 物件，以便 Game 模組使用
            // 我們需要從原始的 gameInstance 中找到這個 piece
            var originalPieceForBestMove = gameInstance.findPieceByPosition(bestMove.from);
            if (originalPieceForBestMove) {
                 var finalMoveObject = {
                    piece: originalPieceForBestMove, // 使用原始遊戲實例中的棋子物件
                    from: bestMove.from,
                    to: bestMove.to
                };
                console.log("[AI] Final chosen move:", finalMoveObject.piece.type, "from", finalMoveObject.from, "to", finalMoveObject.to, "with best score:", bestScore);
                return finalMoveObject;
            } else {
                 console.error("[AI] Could not find original piece for best move. Fallback to random.");
            }
        }
        
        // Fallback to random if anything went wrong
        if (possibleAIMoves.length > 0) {
             var randomFallbackMove = possibleAIMoves[Math.floor(Math.random() * possibleAIMoves.length)];
             console.log("[AI] Fallback to random move:", randomFallbackMove.piece.type, "from", randomFallbackMove.from, "to", randomFallbackMove.to);
             return randomFallbackMove; // 確保 piece 是原始的 piece 物件
        }

        console.log("[AI] No move chosen by Minimax.");
        return null;
    };

})(window.Game = window.Game || {}, window.jQuery || window.Zepto);