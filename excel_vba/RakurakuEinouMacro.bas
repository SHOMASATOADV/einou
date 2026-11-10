Attribute VB_Name = "RakurakuEinouMacro"
Option Explicit

' =============================================================================
' 次世代版「らくらく営農日誌」 既存Excel環境向け 自動取込・面積按分・A4帳票マクロ
' =============================================================================
' 【機能一覧】
' 1. EnsureFieldMasterSheet() : 「M_圃場マスタ」シートを自動生成・初期化し、圃場ID/圃場名から
'                               正確な面積(a)・作付品種をルックアップできるようにする
' 2. ImportPwaOrExternalCsv() : スマホPWA出力CSVや他社アプリ(アグリノート/KSAS)CSVを
'                               ダブルクォーテーション対応CSVパーサーで1クリック取り込み
' 3. AllocateMultiFieldLogs() : 「1作業×複数圃場」の一括日誌データをM_圃場マスタの面積比率
'                               (area_ratio = 個別面積 / 合計面積) で各圃場へ自動按分展開
' 4. ExportJaReportToA4Pdf()  : JA提出用「生産履歴記帳簿（施肥台帳・防除履歴簿）」シートを
'                               A4横1ページ幅で自動整形し、一発PDF出力
' =============================================================================

Public Sub EnsureFieldMasterSheet()
    Dim wsFields As Worksheet
    Set wsFields = GetOrCreateSheet("M_圃場マスタ")

    If Trim(CStr(wsFields.Cells(1, 1).Value)) = "" Then
        wsFields.Range("A1:F1").Value = Array("圃場ID", "圃場名", "地番", "団地・グループ", "面積(a)", "作付品種")
        wsFields.Range("A1:F1").Font.Bold = True
        wsFields.Range("A1:F1").Interior.Color = RGB(4, 120, 87)
        wsFields.Range("A1:F1").Font.Color = RGB(255, 255, 255)

        ' 初期標準圃場マスタデータ（面積比率按分の基準マスタ）
        wsFields.Range("A2:F2").Value = Array("F01", "① 本場1号", "大字下新田 102-1", "本場平場団地", 30, "コシヒカリ(BL)")
        wsFields.Range("A3:F3").Value = Array("F02", "② 本場2号", "大字下新田 102-2", "本場平場団地", 20, "コシヒカリ(BL)")
        wsFields.Range("A4:F4").Value = Array("F03", "③ 本場3号・大町", "大字下新田 105", "本場平場団地", 50, "コシヒカリ(BL)")
        wsFields.Range("A5:F5").Value = Array("F04", "④ 川向4号", "大字川向 44-1", "川向団地", 35, "つきあかり")
        wsFields.Range("A6:F6").Value = Array("F05", "⑤ 上山田A(飛び地)", "上山田字沢 88-1", "上山田中山間団地", 15, "コシヒカリ(BL)")
        wsFields.Range("A7:F7").Value = Array("F06", "⑥ 上山田B(飛び地)", "上山田字沢 89-3", "上山田中山間団地", 18, "コシヒカリ(BL)")
        wsFields.Range("A8:F8").Value = Array("F07", "⑦ 上山田棚田C", "上山田字峯 12-1", "上山田中山間団地", 22, "コシヒカリ(BL)")
        wsFields.Columns("A:F").AutoFit
    End If
End Sub

Public Sub ImportPwaOrExternalCsv()
    Dim filePath As Variant
    Dim stream As Object
    Dim allText As String
    Dim lines As Variant
    Dim rIdx As Long
    Dim lineText As String
    Dim cols As Variant
    Dim wsLog As Worksheet
    Dim nextRow As Long
    Dim importedCount As Long
    Dim colCount As Long

    filePath = Application.GetOpenFilename("CSVファイル (*.csv),*.csv", , "取り込む作業日誌・他社移行CSVを選択してください")
    If VarType(filePath) = vbBoolean And filePath = False Then Exit Sub

    Dim prevCalc As XlCalculation
    prevCalc = Application.Calculation
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.Calculation = xlCalculationManual
    On Error GoTo CleanFail

    Call EnsureFieldMasterSheet

    Set wsLog = GetOrCreateSheet("T_作業日誌")
    If Trim(CStr(wsLog.Cells(1, 1).Value)) = "" Then
        wsLog.Range("A1:I1").Value = Array("作業日", "作業分類", "作業者", "対象圃場", "合計面積(a)", "作業時間(h)", "使用機械", "使用資材・摘要", "按分状態")
        wsLog.Range("A1:I1").Font.Bold = True
        wsLog.Range("A1:I1").Interior.Color = RGB(5, 150, 105)
        wsLog.Range("A1:I1").Font.Color = RGB(255, 255, 255)
    End If

    ' ADODB.Stream による UTF-8 (BOM有無両対応) 読み込み
    On Error GoTo FallbackFso
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2 ' adTypeText
    stream.Charset = "UTF-8"
    stream.Open
    stream.LoadFromFile CStr(filePath)
    allText = stream.ReadText
    stream.Close
    GoTo ParseLines

FallbackFso:
    On Error GoTo CleanFail
    Dim fso As Object, ts As Object
    Set fso = CreateObject("Scripting.FileSystemObject")
    Set ts = fso.OpenTextFile(CStr(filePath), 1, False, -1)
    allText = ts.ReadAll
    ts.Close

ParseLines:
    On Error GoTo CleanFail
    allText = Replace(allText, vbCrLf, vbLf)
    allText = Replace(allText, vbCr, vbLf)
    lines = Split(allText, vbLf)

    importedCount = 0
    ' 1行目（インデックス0：ヘッダー）をスキップして2行目から解析
    For rIdx = 1 To UBound(lines)
        lineText = Trim(CStr(lines(rIdx)))
        If Len(lineText) > 0 Then
            cols = ParseCsvLine(lineText)
            colCount = UBound(cols) - LBound(cols) + 1

            If colCount >= 6 Then
                nextRow = wsLog.Cells(wsLog.Rows.Count, 1).End(xlUp).Row + 1

                ' T_WORK_LOGSテンプレート形式（先頭がWL-等のwork_log_idで列数が15以上）とPWAエクスポート形式の両方に対応
                If colCount >= 15 And Left(CStr(cols(0)), 3) = "WL-" Then
                    wsLog.Cells(nextRow, 1).Value = cols(1)  ' work_date
                    wsLog.Cells(nextRow, 2).Value = cols(2)  ' work_category
                    wsLog.Cells(nextRow, 3).Value = cols(3)  ' worker_name
                    wsLog.Cells(nextRow, 4).Value = cols(4)  ' selected_field_ids ("F01,F02,F03")
                    wsLog.Cells(nextRow, 5).Value = Val(cols(5)) ' total_area_a
                    wsLog.Cells(nextRow, 6).Value = Val(cols(6)) ' total_duration_hr
                    wsLog.Cells(nextRow, 7).Value = cols(7)  ' machine_id
                    wsLog.Cells(nextRow, 8).Value = cols(16) ' notes
                Else
                    wsLog.Cells(nextRow, 1).Value = cols(0) ' 作業日
                    wsLog.Cells(nextRow, 2).Value = cols(1) ' 作業分類
                    wsLog.Cells(nextRow, 3).Value = cols(2) ' 作業者
                    wsLog.Cells(nextRow, 4).Value = cols(3) ' 対象圃場
                    ' ha表記（5未満の小数）の場合は100倍してアール(a)に自動換算
                    If Val(cols(4)) > 0 And Val(cols(4)) < 5 And InStr(CStr(cols(4)), ".") > 0 Then
                        wsLog.Cells(nextRow, 5).Value = Round(Val(cols(4)) * 100, 0)
                    Else
                        wsLog.Cells(nextRow, 5).Value = Val(cols(4))
                    End If
                    wsLog.Cells(nextRow, 6).Value = Val(cols(5)) ' 作業時間(h)
                    If colCount >= 7 Then wsLog.Cells(nextRow, 7).Value = cols(6)
                    If colCount >= 8 Then wsLog.Cells(nextRow, 8).Value = cols(7)
                End If

                wsLog.Cells(nextRow, 9).Value = "未按分"
                importedCount = importedCount + 1
            End If
        End If
    Next rIdx

    wsLog.Columns("A:I").AutoFit
    Call AllocateMultiFieldLogs

CleanExit:
    Application.Calculation = prevCalc
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    MsgBox "スマホ日誌・他社CSVから " & importedCount & " 件を取り込み、M_圃場マスタの面積比率に基づく按分展開を完了しました！", vbInformation, "らくらく営農日誌 Excel連携"
    Exit Sub

CleanFail:
    Application.Calculation = prevCalc
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    MsgBox "CSV取込中にエラーが発生しました: " & Err.Description, vbExclamation, "らくらく営農日誌 Excel連携"
End Sub

Public Sub AllocateMultiFieldLogs()
    Dim wsLog As Worksheet, wsDetail As Worksheet, wsFields As Worksheet
    Dim lastRow As Long, r As Long, dRow As Long, i As Long
    Dim rawFieldStr As String
    Dim fieldTokens As Variant
    Dim fieldCount As Long
    Dim fieldAreas() As Double
    Dim resolvedNames() As String
    Dim sumMasterArea As Double
    Dim totalArea As Double, totalHr As Double
    Dim ratio As Double
    Dim allocArea As Double, allocHr As Double
    Dim token As String
    Dim lookedUpArea As Double, lookedUpName As String

    Dim prevScreen As Boolean, prevEvents As Boolean, prevCalc As XlCalculation
    prevScreen = Application.ScreenUpdating
    prevEvents = Application.EnableEvents
    prevCalc = Application.Calculation
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.Calculation = xlCalculationManual
    On Error GoTo CleanAllocExit

    Call EnsureFieldMasterSheet
    Set wsFields = GetOrCreateSheet("M_圃場マスタ")
    Set wsLog = GetOrCreateSheet("T_作業日誌")
    Set wsDetail = GetOrCreateSheet("T_圃場別カルテ明細")

    If Trim(CStr(wsDetail.Cells(1, 1).Value)) = "" Then
        wsDetail.Range("A1:H1").Value = Array("作業日", "圃場名", "作業分類", "按分面積(a)", "面積按分比(%)", "按分作業時間(h)", "使用機械", "使用資材・成分・収量摘要")
        wsDetail.Range("A1:H1").Font.Bold = True
        wsDetail.Range("A1:H1").Interior.Color = RGB(3, 105, 161)
        wsDetail.Range("A1:H1").Font.Color = RGB(255, 255, 255)
    End If

    lastRow = wsLog.Cells(wsLog.Rows.Count, 1).End(xlUp).Row
    For r = 2 To lastRow
        If wsLog.Cells(r, 9).Value <> "按分済" And Trim(CStr(wsLog.Cells(r, 1).Value)) <> "" Then
            ' 区切り文字（カンマ、読点、中黒）をすべて統一して分割
            rawFieldStr = CStr(wsLog.Cells(r, 4).Value)
            rawFieldStr = Replace(rawFieldStr, "、", ",")
            rawFieldStr = Replace(rawFieldStr, "・", ",")
            fieldTokens = Split(rawFieldStr, ",")

            fieldCount = UBound(fieldTokens) - LBound(fieldTokens) + 1
            If fieldCount < 1 Then fieldCount = 1

            ReDim fieldAreas(0 To fieldCount - 1)
            ReDim resolvedNames(0 To fieldCount - 1)
            sumMasterArea = 0

            ' M_圃場マスタから各圃場の面積(a)と正式名称を取得
            For i = 0 To fieldCount - 1
                token = Trim(CStr(fieldTokens(LBound(fieldTokens) + i)))
                Call LookupFieldMaster(wsFields, token, lookedUpName, lookedUpArea)
                resolvedNames(i) = lookedUpName
                fieldAreas(i) = lookedUpArea
                sumMasterArea = sumMasterArea + lookedUpArea
            Next i

            totalArea = Val(wsLog.Cells(r, 5).Value)
            If sumMasterArea > 0 Then
                ' マスタ合計面積が取得できた場合はマスタ合計面積を基準にする
                If totalArea <= 0 Then totalArea = sumMasterArea
            Else
                ' マスタに未登録の圃場のみだった場合のフォールバック
                sumMasterArea = totalArea
            End If
            wsLog.Cells(r, 5).Value = totalArea
            totalHr = Val(wsLog.Cells(r, 6).Value)

            For i = 0 To fieldCount - 1
                If sumMasterArea > 0 And fieldAreas(i) > 0 Then
                    ratio = fieldAreas(i) / sumMasterArea
                    allocArea = fieldAreas(i)
                Else
                    ratio = 1# / fieldCount
                    allocArea = Round(totalArea * ratio, 1)
                End If
                allocHr = Round(totalHr * ratio, 2)

                dRow = wsDetail.Cells(wsDetail.Rows.Count, 1).End(xlUp).Row + 1
                wsDetail.Cells(dRow, 1).Value = wsLog.Cells(r, 1).Value
                wsDetail.Cells(dRow, 2).Value = resolvedNames(i)
                wsDetail.Cells(dRow, 3).Value = wsLog.Cells(r, 2).Value
                wsDetail.Cells(dRow, 4).Value = allocArea
                wsDetail.Cells(dRow, 5).Value = Round(ratio * 100, 1) & "%"
                wsDetail.Cells(dRow, 6).Value = allocHr
                wsDetail.Cells(dRow, 7).Value = wsLog.Cells(r, 7).Value
                wsDetail.Cells(dRow, 8).Value = wsLog.Cells(r, 8).Value
            Next i

            wsLog.Cells(r, 9).Value = "按分済"
        End If
    Next r

    wsDetail.Columns("A:H").AutoFit

CleanAllocExit:
    Application.Calculation = prevCalc
    Application.EnableEvents = prevEvents
    Application.ScreenUpdating = prevScreen
End Sub

Public Sub ExportJaReportToA4Pdf()
    Dim wsReport As Worksheet
    Dim pdfPath As String

    Set wsReport = ActiveSheet
    With wsReport.PageSetup
        .Orientation = xlLandscape ' A4横
        .PaperSize = xlPaperA4
        .Zoom = False
        .FitToPagesWide = 1
        .FitToPagesTall = False
        .CenterHorizontally = True
    End With

    pdfPath = ThisWorkbook.Path
    If pdfPath = "" Then pdfPath = CurDir
    pdfPath = pdfPath & "\JA提出用_生産履歴記帳簿_" & Format(Now, "yyyymmdd_hhnn") & ".pdf"
    wsReport.ExportAsFixedFormat Type:=xlTypePDF, Filename:=pdfPath, Quality:=xlQualityStandard, OpenAfterPublish:=True
    MsgBox "A4完成帳票PDFを出力しました：" & vbCrLf & pdfPath, vbInformation, "A4帳票一発出力"
End Sub

' =============================================================================
' ヘルパー関数：ダブルクォーテーション内のカンマを正しく保持するCSV行パーサー
' =============================================================================
Private Function ParseCsvLine(ByVal lineText As String) As Variant
    Dim result() As String
    Dim colIdx As Long
    Dim i As Long
    Dim ch As String
    Dim inQuotes As Boolean
    Dim curVal As String

    ReDim result(0 To 0)
    colIdx = 0
    inQuotes = False
    curVal = ""

    For i = 1 To Len(lineText)
        ch = Mid$(lineText, i, 1)
        If ch = """" Then
            If inQuotes And i < Len(lineText) And Mid$(lineText, i + 1, 1) = """" Then
                ' エスケープされた二重引用符 ("")
                curVal = curVal & """"
                i = i + 1
            Else
                inQuotes = Not inQuotes
            End If
        ElseIf ch = "," And Not inQuotes Then
            result(colIdx) = Trim$(curVal)
            colIdx = colIdx + 1
            ReDim Preserve result(0 To colIdx)
            curVal = ""
        Else
            curVal = curVal & ch
        End If
    Next i

    result(colIdx) = Trim$(curVal)
    ParseCsvLine = result
End Function

' =============================================================================
' ヘルパー関数：M_圃場マスタから圃場IDまたは圃場名（部分一致可）で面積(a)を検索
' =============================================================================
Private Sub LookupFieldMaster(wsFields As Worksheet, ByVal keyStr As String, ByRef outName As String, ByRef outArea As Double)
    Dim lastRow As Long, r As Long
    Dim fId As String, fName As String, fArea As Double

    outName = keyStr
    outArea = 0

    If keyStr = "" Then Exit Sub

    lastRow = wsFields.Cells(wsFields.Rows.Count, 1).End(xlUp).Row
    For r = 2 To lastRow
        fId = Trim(CStr(wsFields.Cells(r, 1).Value))
        fName = Trim(CStr(wsFields.Cells(r, 2).Value))
        fArea = Val(wsFields.Cells(r, 5).Value)

        If StrComp(fId, keyStr, vbTextCompare) = 0 Or _
           StrComp(fName, keyStr, vbTextCompare) = 0 Or _
           (Len(keyStr) >= 2 And (InStr(1, fName, keyStr, vbTextCompare) > 0 Or InStr(1, keyStr, fName, vbTextCompare) > 0)) Then
            outName = fName
            outArea = fArea
            Exit Sub
        End If
    Next r
End Sub

Private Function GetOrCreateSheet(sheetName As String) As Worksheet
    On Error Resume Next
    Set GetOrCreateSheet = ThisWorkbook.Worksheets(sheetName)
    On Error GoTo 0
    If GetOrCreateSheet Is Nothing Then
        Set GetOrCreateSheet = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        GetOrCreateSheet.Name = sheetName
    End If
End Function
