' Bishnoi One's PS-PhilGEPS log-in on a team laptop (docs/PLAN.md 25, the bidding system's pop-up log-in).
' Opens the PS-PhilGEPS log-in in Chrome with everything filled in, without a console window. Tick
' "I'm not a robot"; the session then goes to Bishnoi One for the whole team.
' Opened by Bishnoi One's "Fetch PS-PhilGEPS now" button through the link "bishnoi-ps-connect:" (set up once
' per laptop by register-connect-link.js). Its own link, not the bidding system's "ps-philgeps-connect:",
' so a laptop set up for both keeps both working.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
shell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
' The link "bishnoi-ps-connect:start?code=..." is passed on only when it holds nothing but letters, digits
' and . _ - = ? & : /. The log-in module (ps-philgeps-session.js, the bidding system's own, unchanged) reads
' the one-time code from a "ps-philgeps-connect:" link, so the link is handed to it under that name.
link = ""
If WScript.Arguments.Count > 0 Then
    Set re = New RegExp
    re.Pattern = "^bishnoi-ps-connect:[A-Za-z0-9._?&=:/-]{0,500}$"
    re.IgnoreCase = True
    If re.Test(WScript.Arguments(0)) Then link = " ""ps-philgeps-connect:" & Mid(WScript.Arguments(0), Len("bishnoi-ps-connect:") + 1) & """"
End If
' 0 = no window, True = wait for the log-in to finish
code = shell.Run("node ps-philgeps-session.js --connect" & link, 0, True)
If code <> 0 Then
    MsgBox "The PS-PhilGEPS log-in did not finish. Bishnoi One's Tender finder says why (bottom right); then press Fetch PS-PhilGEPS now again." & vbCrLf & "(Details: .ps-philgeps\session.log in this folder.)", vbExclamation, "PS-PhilGEPS log-in"
End If
