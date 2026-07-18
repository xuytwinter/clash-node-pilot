Option Explicit

Dim arguments, command, index, shell
Set arguments = WScript.Arguments

If arguments.Count = 0 Then
    WScript.Quit 2
End If

command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(arguments(0))
For index = 1 To arguments.Count - 1
    command = command & " " & Quote(arguments(index))
Next

Set shell = CreateObject("WScript.Shell")
WScript.Quit shell.Run(command, 0, True)

Function Quote(value)
    Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
