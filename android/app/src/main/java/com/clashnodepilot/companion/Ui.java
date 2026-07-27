package com.clashnodepilot.companion;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

final class Ui {
    private static final int BG = Color.rgb(246, 248, 251);
    private static final int SURFACE = Color.WHITE;
    private static final int TEXT = Color.rgb(20, 27, 38);
    private static final int MUTED = Color.rgb(92, 104, 121);
    private static final int BLUE = Color.rgb(37, 99, 235);

    static ScrollView root(MainActivity activity) {
        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        return scroll;
    }

    static LinearLayout column(Context context, int paddingDp) {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(context, paddingDp);
        layout.setPadding(pad, pad, pad, pad);
        return layout;
    }

    static LinearLayout row(Context context) {
        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        return row;
    }

    static TextView title(MainActivity activity, String text) {
        TextView view = text(activity, text, 24, TEXT);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    static TextView sectionTitle(MainActivity activity, String text) {
        TextView view = text(activity, text, 16, TEXT);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setPadding(0, dp(activity, 12), 0, dp(activity, 4));
        return view;
    }

    static TextView body(MainActivity activity, String text) {
        TextView view = text(activity, text, 14, MUTED);
        view.setLineSpacing(0, 1.15f);
        return view;
    }

    static TextView status(MainActivity activity) {
        TextView view = text(activity, "", 14, TEXT);
        view.setPadding(dp(activity, 12), dp(activity, 10), dp(activity, 12), dp(activity, 10));
        view.setBackgroundColor(Color.rgb(232, 238, 252));
        return view;
    }

    static EditText input(MainActivity activity, String hint) {
        EditText input = new EditText(activity);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setTextColor(TEXT);
        input.setHintTextColor(MUTED);
        input.setTextSize(15);
        input.setPadding(dp(activity, 10), 0, dp(activity, 10), 0);
        input.setMinHeight(dp(activity, 48));
        return input;
    }

    static Button primaryButton(MainActivity activity, String text) {
        Button button = button(activity, text);
        button.setTextColor(Color.WHITE);
        button.setBackgroundColor(BLUE);
        return button;
    }

    static Button secondaryButton(MainActivity activity, String text) {
        Button button = button(activity, text);
        button.setTextColor(TEXT);
        button.setBackgroundColor(SURFACE);
        return button;
    }

    static void add(LinearLayout parent, View child) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(parent.getContext(), 6), 0, dp(parent.getContext(), 6));
        parent.addView(child, params);
    }

    static void addWeighted(LinearLayout parent, View child) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
        params.setMargins(dp(parent.getContext(), 3), dp(parent.getContext(), 4), dp(parent.getContext(), 3), dp(parent.getContext(), 4));
        parent.addView(child, params);
    }

    static int dp(Context context, int value) {
        return (int) (value * context.getResources().getDisplayMetrics().density + 0.5f);
    }

    private static TextView text(MainActivity activity, String text, int sp, int color) {
        TextView view = new TextView(activity);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(color);
        return view;
    }

    private static Button button(MainActivity activity, String text) {
        Button button = new Button(activity);
        button.setAllCaps(false);
        button.setText(text);
        button.setTextSize(14);
        button.setMinHeight(dp(activity, 46));
        return button;
    }
}
